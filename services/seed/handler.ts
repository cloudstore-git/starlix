import { db, key } from '../shared/db';
import type { Client, Correspondent, Individual, OnboardingStatus, Transaction, TxSettings } from '../shared/types';
import { DEFAULT_TX_SETTINGS } from '../shared/types';
import { nowIso, uuid } from '../shared/util';
import { REGISTRY } from '../stubs/registry';
import { saveClient, saveCorrespondent } from '../clients/repo';
import { newChildClient } from '../clients/handler';
import { buildTransaction, ingest } from '../transactions/handler';
import { saveAccount, saveBranding } from '../identity/handler';
import { createUser, updateUserLink } from '../identity/cognito';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { routes as onboardingRoutes, seedFormStatus } from '../onboarding/handler';
import { setEventSink } from '../shared/events';
import type { AuthContext } from '../shared/http';
import { addMonths } from '../shared/util';
import { deliverInProcess } from './in-process';

/**
 * Loads the same demo data the original Kotlin app bootstrapped: EMoney Plus as the top-level account,
 * seven PSPs in different onboarding states (onboarded through the real routes), customers, correspondents and transactions.
 * Invoke with { "demoPassword": "...", "reset": true } from deploy.sh.
 */
export interface SeedEvent {
  tenant?: string;
  reset?: boolean;
  demoPassword?: string;
  adminEmail?: string;
  createUsers?: boolean;
}

const tables = () =>
  ['CLIENTS_TABLE', 'ONBOARDING_TABLE', 'CHECKS_TABLE', 'TRANSACTIONS_TABLE', 'IDENTITY_TABLE']
    .map((n) => process.env[n])
    .filter((t): t is string => !!t);

/** Small deterministic PRNG so every reset produces the same demo. */
export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const PSPS: { name: string; status: OnboardingStatus }[] = [
  { name: 'ClickCash Ltd', status: 'APPROVED' },
  { name: 'PayMate Payments Ltd', status: 'APPROVED' },
  { name: 'Walletly Ltd', status: 'APPROVED' },
  { name: 'DigiCash Services Ltd', status: 'EXPIRED' },
  { name: 'CreditBond Ltd', status: 'CHECKS_FAILED' },
  { name: 'Bluepeak Money Ltd', status: 'IN_REVIEW' },
  { name: 'Northwind Remit Ltd', status: 'NOT_STARTED' },
];

const CUSTOMERS: Individual[][] = [
  [
    { firstName: 'Ashlyn', lastName: 'Heathcote', dateOfBirth: '1988-02-11', nationality: 'GB', email: 'ashlyn@example.com' },
    { firstName: 'Mohammed', lastName: 'Rahman', dateOfBirth: '1979-06-30', nationality: 'GB', email: 'mo.rahman@example.com' },
    { firstName: 'Chloe', lastName: 'Fraser', dateOfBirth: '1995-10-04', nationality: 'GB', email: 'chloe.f@example.com' },
  ],
  [
    { firstName: 'Lucía', lastName: 'Navarro', dateOfBirth: '1990-01-21', nationality: 'ES', email: 'lucia.n@example.com' },
    { firstName: 'Tom', lastName: 'Whitaker', dateOfBirth: '1983-08-15', nationality: 'GB', email: 'tom.w@example.com' },
    { firstName: 'Priya', lastName: 'Shah', dateOfBirth: '1992-12-02', nationality: 'GB', email: 'priya.shah@example.com' },
  ],
  [
    { firstName: 'Daniel', lastName: 'Okoye', dateOfBirth: '1986-04-09', nationality: 'NG', email: 'd.okoye@example.com' },
    { firstName: 'Hannah', lastName: 'Lewis', dateOfBirth: '1998-07-27', nationality: 'GB', email: 'hannah.l@example.com' },
    { firstName: 'Marco', lastName: 'Ferri', dateOfBirth: '1975-03-18', nationality: 'IT', email: 'marco.ferri@example.com' },
  ],
];

const CORRESPONDENTS: Record<string, { name: string; type: 'BANK' | 'PARTNER'; country: string; corridors?: string[]; valid: boolean }[]> = {
  'ClickCash Ltd': [
    { name: 'Cash Nigeria', type: 'PARTNER', country: 'NG', corridors: ['NG', 'ET'], valid: false },
    { name: 'UniCredit Spa', type: 'BANK', country: 'IT', valid: true },
  ],
  'PayMate Payments Ltd': [
    { name: 'CashEspania', type: 'PARTNER', country: 'ES', corridors: ['ES'], valid: true },
    { name: 'Intesa Sanpaolo', type: 'BANK', country: 'IT', valid: false },
  ],
  'Walletly Ltd': [{ name: 'AmericasPayments', type: 'PARTNER', country: 'US', corridors: ['US', 'CA'], valid: true }],
};

const CUSTOMER_INCOMING: TxSettings = { ...DEFAULT_TX_SETTINGS, jurisdictions: ['FR', 'GB'] };
const CUSTOMER_OUTGOING: TxSettings = { ...DEFAULT_TX_SETTINGS, jurisdictions: ['ES', 'GB', 'IT', 'NG', 'US'] };

const isoDaysFromToday = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

type FileWriter = (key: string, body: string, contentType: string) => Promise<void>;

/** Demo documents go to the files bucket; the local server swaps in its in-memory store. */
let writeFile: FileWriter = async (key, body, contentType) => {
  if (!process.env.FILES_BUCKET) return;
  await new S3Client({}).send(new PutObjectCommand({ Bucket: process.env.FILES_BUCKET, Key: key, Body: body, ContentType: contentType }));
};

export function setSeedFileWriter(w: FileWriter) {
  writeFile = w;
}

async function demoFile(tenant: string, name: string, title: string) {
  const key = `t/${tenant}/seed/${uuid()}/${name}`;
  await writeFile(key, `${title}\n\nDemo document created by the Starlix seed. Not a real document.\n`, 'text/plain');
  return { key, name };
}

/**
 * Takes a PSP through the real onboarding routes as the root client would, so forms, sections,
 * checks and notes look exactly like ones made in the UI. Events run in-process so the outcome
 * is known before the seed continues.
 */
async function onboardPsp(tenant: string, root: Client, psp: Client, target: OnboardingStatus) {
  if (target === 'NOT_STARTED') return;
  const domain = `${psp.name.split(' ')[0].toLowerCase()}.example`;
  const as = (clientId: string, email: string): AuthContext => ({ userId: 'seed', email, tenant, clientId, groups: ['USER'], isAdmin: false });
  const rootAuth = as(root.id, 'compliance@emoneyplus.demo');
  // Forms filled by the root team are approved as soon as checks pass; an invited PSP's form waits for review
  const invited = target === 'IN_REVIEW';
  let auth = rootAuth;
  const call = (route: string, params: Record<string, string>, body: any = {}) =>
    onboardingRoutes[route]({ method: route.split(' ')[0], path: route.split(' ')[1], params, query: {}, body, auth });

  const form = await call('POST /clients/{clientId}/onboarding', { clientId: psp.id }, {
    onboardingType: 'REGULATED',
    prefill: true,
    expiresMonths: 12,
    invite: invited,
    inviteEmail: invited ? `compliance@${domain}` : undefined,
  });
  if (invited) {
    await deliverInProcess('UserActivated', { tenant, clientId: psp.id, email: `compliance@${domain}` });
    auth = as(psp.id, `compliance@${domain}`);
  }
  const address = { ...psp.company!.registeredAddress! };
  const sections: Record<string, any> = {
    'primary-contact': { individual: { firstName: 'Olivia', lastName: 'Bennett', dateOfBirth: '1987-05-14', email: `olivia@${domain}`, nationality: 'GB', address } },
    mlro: { individual: { firstName: 'Samuel', lastName: 'Clarke', dateOfBirth: '1980-11-02', email: `mlro@${domain}`, nationality: 'GB', address } },
    'licensing-information': {
      regulator: 'Financial Conduct Authority',
      licenseNumber: `FRN ${900000 + Math.floor(Number(psp.company!.registrationNumber) % 99999)}`,
      licensingDocuments: [await demoFile(tenant, 'fca-authorisation.txt', `FCA authorisation for ${psp.name}`)],
    },
    'independent-audit': {
      conductedBy: 'Grant & Partners LLP',
      auditDate: '2026-03-31',
      auditFiles: [await demoFile(tenant, 'audit-report-2026.txt', `Independent audit of ${psp.name}`)],
    },
    'banking-details': { accountName: psp.name, accountNumber: '41234567', sortCode: '20-00-00', bankName: 'Barclays Bank UK PLC' },
  };
  for (const [name, data] of Object.entries(sections)) {
    await call('PUT /onboarding/{formId}/sections/{sectionName}', { formId: form.id, sectionName: name }, { data });
  }
  // Prefilled directors become shareholders, splitting the company between them
  const view = await call('GET /onboarding/{formId}', { formId: form.id });
  const directors = view.sections.find((s: any) => s.requirement.sectionName === 'directors').data.directors;
  const share = Math.floor(100 / directors.length);
  await call('PUT /onboarding/{formId}/sections/{sectionName}', { formId: form.id, sectionName: 'directors' }, {
    data: { directors: directors.map((d: any) => ({ ...d, shareholder: true, beneficialOwner: share >= 25 })) },
  });
  const after = await call('GET /onboarding/{formId}', { formId: form.id });
  const shareholders = after.sections.find((s: any) => s.requirement.sectionName === 'shareholders').data.shareholders;
  await call('PUT /onboarding/{formId}/sections/{sectionName}', { formId: form.id, sectionName: 'shareholders' }, {
    data: { shareholders: shareholders.map((x: any) => ({ ...x, sharePercent: share })) },
  });

  if (target === 'PENDING') return;
  await call('POST /onboarding/{formId}/submit', { formId: form.id });
  if (target === 'EXPIRED') {
    await seedFormStatus(tenant, form.id, 'EXPIRED', { approvedAt: addMonths(nowIso(), -13) });
  }
}

function registryCompanyByName(name: string) {
  const r = REGISTRY.find((x) => x.company.name === name);
  if (!r) throw new Error(`Seed company ${name} missing from registry`);
  return structuredClone(r.company);
}

async function ensureUser(email: string, group: 'ADMIN' | 'USER', tenant: string, password: string, clientId?: string, accountId?: string) {
  try {
    await createUser({ email, group, tenant, clientId, accountId, password });
    return 'created';
  } catch (e: any) {
    if (e?.name === 'UsernameExistsException') {
      await updateUserLink(email, tenant, clientId, accountId, password);
      return 'updated';
    }
    throw e;
  }
}

export async function seed(event: SeedEvent = {}) {
  const tenant = event.tenant ?? process.env.DEFAULT_TENANT ?? 'default';
  const marker = { table: process.env.IDENTITY_TABLE!, pk: key(tenant, 'SEED'), sk: 'META' };

  if (event.reset) {
    for (const t of tables()) await db().deleteByPkPrefix(t, `T#${tenant}#`);
  } else {
    const existing = await db().get<any>(marker.table, marker.pk, marker.sk);
    if (existing) return { status: 'already-seeded', rootClientId: existing.rootClientId };
  }

  const rnd = rng(7);
  const rootCompany = registryCompanyByName('EMoney Plus Ltd');
  const rootId = uuid();
  const root: Client = {
    id: rootId,
    kind: 'ROOT',
    type: 'COMPANY',
    name: 'EMoney Plus',
    chain: [],
    rootClientId: rootId,
    onboardingStatus: 'APPROVED',
    company: rootCompany,
    incomingTxSettings: DEFAULT_TX_SETTINGS,
    outgoingTxSettings: DEFAULT_TX_SETTINGS,
    createdAt: nowIso(),
  };
  await saveClient(tenant, root);
  const rootAccount = await saveAccount(tenant, { id: uuid(), name: root.name, clientId: root.id, createdAt: nowIso() });
  await saveBranding(tenant, { name: 'EMoney Plus', logo: '/images/logo.svg', primaryColor: '#1e40af' });

  const transactions: Transaction[] = [];
  let pspUser: { clientId: string; accountId: string } | undefined;

  // Onboarding events run in-process during the seed (with no stub delay) so each PSP ends in its target status
  const delay = process.env.STUB_DELAY_MS;
  process.env.STUB_DELAY_MS = '0';
  const previousSink = setEventSink(deliverInProcess);
  const psps: Client[] = [];
  try {
    for (const p of PSPS) {
      const psp = newChildClient(root, { type: 'COMPANY', company: registryCompanyByName(p.name) });
      psp.onboardingStatus = 'NOT_STARTED';
      await saveClient(tenant, psp);
      await onboardPsp(tenant, root, psp, p.status);
      psps.push(psp);
    }
  } finally {
    setEventSink(previousSink);
    if (delay === undefined) delete process.env.STUB_DELAY_MS;
    else process.env.STUB_DELAY_MS = delay;
  }

  for (const [i, p] of PSPS.entries()) {
    const psp = psps[i];
    if (p.status !== 'APPROVED') continue;

    const pspAccount = await saveAccount(tenant, { id: uuid(), name: psp.name, clientId: psp.id, createdAt: nowIso() });
    if (i === 0) pspUser = { clientId: psp.id, accountId: pspAccount.id };

    const correspondents: Correspondent[] = [];
    for (const c of CORRESPONDENTS[p.name] ?? []) {
      correspondents.push(
        await saveCorrespondent(tenant, {
          id: uuid(),
          type: c.type,
          company: { name: c.name, jurisdiction: c.country, registrationNumber: `${c.country}-${Math.floor(rnd() * 1e7)}` },
          name: c.name,
          onboardingStatus: c.valid ? 'APPROVED' : 'LICENSE_EXPIRED',
          clientId: psp.id,
          rootClientId: root.id,
          licenseExpires: c.valid ? isoDaysFromToday(300) : isoDaysFromToday(-20),
          licenseDocuments: [],
          corridors: c.corridors,
          iban: c.type === 'BANK' ? 'IT60X0542811101000000123456' : undefined,
        }),
      );
    }

    const customers: Client[] = [];
    for (const individual of CUSTOMERS[i] ?? []) {
      const c = newChildClient(psp, {
        type: 'INDIVIDUAL',
        individual: { ...individual, address: { addressLine1: '12 Market Street', city: 'London', postCode: 'E1 6AN', countryCode: 'GB' } },
        uniqueReference: `${psp.name.slice(0, 3).toUpperCase()}-${1000 + customers.length + 1}`,
      });
      c.onboardingStatus = 'APPROVED';
      c.incomingTxSettings = structuredClone(CUSTOMER_INCOMING);
      c.outgoingTxSettings = structuredClone(CUSTOMER_OUTGOING);
      customers.push(await saveClient(tenant, c));
    }

    // Two customers per PSP get activity, as in the original MockAccountBootstrapConfig
    for (const customer of customers.slice(0, 2)) {
      const when = () => new Date(Date.now() - Math.floor(rnd() * 10 * 86_400_000) - Math.floor(rnd() * 1000) * 60_000).toISOString();
      const amount = (n: number) => Math.round((1000_00 * n + rnd() * n * n * 4000_00) / 100) * 100;
      const partner = correspondents.find((c) => c.type === 'PARTNER');
      const bank = correspondents.find((c) => c.type === 'BANK');
      for (let n = 1; n <= 2; n++) {
        if (partner) transactions.push(buildTransaction({ customer, type: 'OUTGOING', amount: amount(n), country: partner.company.jurisdiction, correspondent: partner, timestamp: when() }));
        if (bank) transactions.push(buildTransaction({ customer, type: 'OUTGOING', amount: amount(n), country: bank.company.jurisdiction, correspondent: bank, timestamp: when() }));
        transactions.push(buildTransaction({ customer, type: 'OUTGOING', amount: amount(n), country: 'IT', timestamp: when() }));
      }
      for (let n = 1; n <= 3; n++) {
        transactions.push(buildTransaction({ customer, type: 'INCOMING', amount: amount(n), country: rnd() < 0.5 ? 'PT' : 'FR', timestamp: when() }));
      }
    }
  }

  // One batch so monthly limits see every earlier transaction of the same customer
  const saved = await ingest(tenant, transactions);

  const users: Record<string, string> = {};
  if (event.createUsers !== false && event.demoPassword && process.env.USER_POOL_ID) {
    const admin = event.adminEmail ?? 'admin@starlix.demo';
    users[admin] = await ensureUser(admin, 'ADMIN', tenant, event.demoPassword);
    users['compliance@emoneyplus.demo'] = await ensureUser('compliance@emoneyplus.demo', 'USER', tenant, event.demoPassword, root.id, rootAccount.id);
    if (pspUser) {
      users['ops@clickcash.demo'] = await ensureUser('ops@clickcash.demo', 'USER', tenant, event.demoPassword, pspUser.clientId, pspUser.accountId);
    }
  }

  await db().put(marker.table, { PK: marker.pk, SK: marker.sk, rootClientId: root.id, seededAt: nowIso() });
  return {
    status: 'seeded',
    rootClientId: root.id,
    transactions: saved.length,
    onHold: saved.filter((t) => t.status === 'ON_HOLD').length,
    users,
  };
}

export const handler = async (event: SeedEvent) => seed(event);
