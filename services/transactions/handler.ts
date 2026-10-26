import { db, key, strip } from '../shared/db';
import {
  Request,
  Routes,
  badRequest,
  dispatch,
  forbidden,
  isEventBridgeEvent,
  isHttpEvent,
  notFound,
  paginate,
  requireClientId,
  requireFields,
} from '../shared/http';
import type { Client, Company, Correspondent, Entity, OnboardingStatus, StoredFile, Transaction, TransactionType } from '../shared/types';
import { nowIso, uuid } from '../shared/util';
import { evaluateRisks, gbpAmount, monthlyStatsFor } from '../domain/risk';
import { getAccessibleClient, getClients, getCorrespondent, listCorrespondentsByPsp, mustGetClient } from '../clients/repo';

/**
 * Transactions table layout (tenant prefix omitted):
 *   Transaction  PK TX#<id>  SK META
 *     GSI1 ROOT#<rootClientId> -> <status>#<timestamp>#<id>
 *     GSI2 PSP#<pspClientId>   -> <timestamp>#<id>
 *     GSI3 CLIENT#<clientId>   -> <timestamp>#<id>
 */
const table = () => process.env.TRANSACTIONS_TABLE ?? 'transactions';

async function saveTx(tenant: string, tx: Transaction) {
  await db().put(table(), {
    PK: key(tenant, 'TX', tx.id),
    SK: 'META',
    GSI1PK: key(tenant, 'ROOT', tx.rootClientId),
    GSI1SK: `${tx.status}#${tx.timestamp}#${tx.id}`,
    GSI2PK: key(tenant, 'PSP', tx.pspClientId),
    GSI2SK: `${tx.timestamp}#${tx.id}`,
    GSI3PK: key(tenant, 'CLIENT', tx.clientId),
    GSI3SK: `${tx.timestamp}#${tx.id}`,
    ...tx,
  });
  return tx;
}

async function getTx(tenant: string, id: string): Promise<Transaction | undefined> {
  return strip<Transaction>(await db().get(table(), key(tenant, 'TX', id), 'META'));
}

async function txsByIndex(tenant: string, index: 'GSI1' | 'GSI2' | 'GSI3', prefix: string, id: string, skPrefix?: string) {
  const items = await db().query(table(), { index, pk: key(tenant, prefix, id), skPrefix });
  return items.map((i) => strip<Transaction>(i));
}

const byNewest = (a: Transaction, b: Transaction) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0);

/**
 * Re-evaluates risk for a set of transactions. Monthly stats need each client's full history,
 * so all transactions of every affected client are loaded.
 */
export async function reprocess(
  tenant: string,
  txs: Transaction[],
  overrides: { clientStatus?: Record<string, OnboardingStatus> } = {},
): Promise<Transaction[]> {
  if (!txs.length) return [];
  const clientIds = [...new Set(txs.flatMap((t) => [t.clientId, t.pspClientId]))];
  const clients = new Map((await getClients(tenant, clientIds)).map((c) => [c.id, c]));
  for (const [id, status] of Object.entries(overrides.clientStatus ?? {})) {
    const c = clients.get(id);
    if (c) clients.set(id, { ...c, onboardingStatus: status });
  }
  const correspondents = new Map<string, Correspondent | undefined>();
  for (const id of new Set(txs.map((t) => t.correspondentId).filter((x): x is string => !!x))) {
    correspondents.set(id, await getCorrespondent(tenant, id));
  }
  const history: Transaction[] = [];
  for (const clientId of new Set(txs.map((t) => t.clientId))) {
    history.push(...(await txsByIndex(tenant, 'GSI3', 'CLIENT', clientId)));
  }
  // Include the transactions being processed (new ones are not stored yet)
  const ids = new Set(history.map((h) => h.id));
  for (const t of txs) if (!ids.has(t.id)) history.push(t);
  const stats = monthlyStatsFor(history);

  const out: Transaction[] = [];
  for (const tx of txs) {
    const customer = clients.get(tx.clientId);
    const psp = clients.get(tx.pspClientId);
    if (!customer || !psp) continue;
    const risks = evaluateRisks({
      tx,
      customer,
      psp,
      correspondent: tx.correspondentId ? correspondents.get(tx.correspondentId) : undefined,
      monthly: stats.get(tx.id) ?? { count: 0, total: 0 },
    });
    // Status is part of the GSI1 sort key; saveTx replaces the whole item so the index follows.
    const updated: Transaction = { ...tx, risks, status: risks.length ? 'ON_HOLD' : 'APPROVED' };
    out.push(await saveTx(tenant, updated));
  }
  return out;
}

function canSee(tx: Transaction, actor: string) {
  return tx.clientId === actor || tx.pspClientId === actor || tx.chain.includes(actor);
}

async function listFor(req: Request): Promise<Transaction[]> {
  const tenant = req.auth.tenant;
  const actor = requireClientId(req.auth);
  const me = await mustGetClient(tenant, actor);
  const q = req.query;
  let txs: Transaction[];
  if (q.clientId) {
    await getAccessibleClient(tenant, q.clientId, actor);
    txs = await txsByIndex(tenant, 'GSI3', 'CLIENT', q.clientId);
  } else if (q.pspId || me.kind === 'PSP') {
    const pspId = q.pspId ?? me.id;
    await getAccessibleClient(tenant, pspId, actor);
    txs = await txsByIndex(tenant, 'GSI2', 'PSP', pspId);
  } else if (me.kind === 'ROOT') {
    txs = await txsByIndex(tenant, 'GSI1', 'ROOT', me.id, q.status ? `${q.status}#` : undefined);
  } else {
    txs = await txsByIndex(tenant, 'GSI3', 'CLIENT', me.id);
  }
  if (q.status) txs = txs.filter((t) => t.status === q.status);
  if (q.type) txs = txs.filter((t) => t.type === q.type);
  return txs.sort(byNewest);
}

async function withNames(tenant: string, txs: Transaction[]) {
  const clients = await getClients(tenant, txs.flatMap((t) => [t.clientId, t.pspClientId]));
  const names = new Map(clients.map((c) => [c.id, c.name]));
  return txs.map((t) => ({ ...t, clientName: names.get(t.clientId), pspName: names.get(t.pspClientId), gbpAmount: gbpAmount(t) }));
}

// ---- Simulation (demo data generator) ----

const COUNTRY_CURRENCY: Record<string, string> = { GB: 'GBP', US: 'USD', NG: 'NGN', ES: 'EUR', DE: 'EUR', PT: 'EUR', FR: 'EUR', IT: 'EUR' };
const FX_TO_GBP: Record<string, number> = { GBP: 1, EUR: 0.86, USD: 0.79, NGN: 0.00052 };
const BANKS: Record<string, string[]> = {
  FR: ['Société Générale', 'Crédit Mutuel'],
  PT: ['Novobanco', 'Banco BPI'],
  IT: ['UniCredit', 'Banca Sella'],
  ES: ['Banco Sabadell', 'Bankinter'],
  DE: ['Commerzbank', 'DZ Bank'],
  US: ['First Republic Trust', 'Lakeside Bank'],
  NG: ['Zenith Bank', 'Access Bank'],
  GB: ['Barclays', 'Lloyds'],
};
const FIRST = ['Marie', 'Luca', 'Sofia', 'João', 'Emma', 'Mateo', 'Chidi', 'Anna', 'Paul', 'Inès'];
const LAST = ['Dubois', 'Rossi', 'García', 'Silva', 'Müller', 'Okafor', 'Martin', 'Bianchi', 'Costa', 'Smith'];

const pick = <T>(xs: T[], rnd: () => number) => xs[Math.floor(rnd() * xs.length)];

export function bankCompany(country: string, rnd: () => number = Math.random): Company {
  const name = pick(BANKS[country] ?? BANKS.GB, rnd);
  return { name, jurisdiction: country, registrationNumber: `${country}-${Math.floor(rnd() * 1e8)}` };
}

export function counterparty(country: string, rnd: () => number = Math.random): Entity {
  const firstName = pick(FIRST, rnd);
  const lastName = pick(LAST, rnd);
  return {
    id: uuid(),
    type: 'INDIVIDUAL',
    name: `${firstName} ${lastName}`,
    individual: { firstName, lastName, nationality: country, address: { addressLine1: '1 Main Street', city: 'City', postCode: '0000', countryCode: country } },
  };
}

export interface NewTxInput {
  customer: Client;
  type: TransactionType;
  /** GBP amount in pence */
  amount: number;
  country: string;
  correspondent?: Correspondent;
  timestamp?: string;
  counterpartyEntity?: Entity;
  bank?: Company;
}

/** Builds a transaction for a customer. GBP is the platform side; the counterparty side uses the country's currency. */
export function buildTransaction(input: NewTxInput): Transaction {
  const { customer, type, amount, country } = input;
  const foreign = COUNTRY_CURRENCY[country] ?? 'EUR';
  const rate = FX_TO_GBP[foreign] ?? 1;
  const foreignAmount = Math.round(amount / rate);
  const base = {
    id: uuid(),
    type,
    clientId: customer.id,
    pspClientId: customer.parentClientId!,
    rootClientId: customer.rootClientId,
    chain: customer.chain,
    risks: [],
    status: 'APPROVED' as const,
    supportingDocuments: [],
    timestamp: input.timestamp ?? nowIso(),
  };
  if (type === 'INCOMING') {
    return {
      ...base,
      sentAmount: foreignAmount,
      sentCurrency: foreign,
      receivedAmount: amount,
      receivedCurrency: 'GBP',
      fxRate: 1 / rate,
      sender: input.counterpartyEntity ?? counterparty(country),
      senderBank: input.bank ?? bankCompany(country),
    };
  }
  return {
    ...base,
    sentAmount: amount,
    sentCurrency: 'GBP',
    receivedAmount: foreignAmount,
    receivedCurrency: foreign,
    fxRate: rate,
    beneficiary: input.counterpartyEntity ?? counterparty(country),
    beneficiaryBank: input.correspondent ? undefined : (input.bank ?? bankCompany(country)),
    correspondentId: input.correspondent?.id,
  };
}

export async function ingest(tenant: string, txs: Transaction[]): Promise<Transaction[]> {
  return reprocess(tenant, txs);
}

export const routes: Routes = {
  'GET /transactions': async (req) => paginate(await withNames(req.auth.tenant, await listFor(req)), req.query),

  'GET /transactions/{transactionId}': async (req) => {
    const tenant = req.auth.tenant;
    const tx = await getTx(tenant, req.params.transactionId);
    if (!tx) throw notFound('Transaction not found');
    if (!canSee(tx, requireClientId(req.auth))) throw forbidden('No access to this transaction');
    const [customer, psp] = await Promise.all([mustGetClient(tenant, tx.clientId), mustGetClient(tenant, tx.pspClientId)]);
    const correspondent = tx.correspondentId ? await getCorrespondent(tenant, tx.correspondentId) : undefined;
    return { transaction: { ...tx, gbpAmount: gbpAmount(tx) }, customer, psp, correspondent };
  },

  'POST /transactions/{transactionId}/documents': async (req) => {
    const tenant = req.auth.tenant;
    const tx = await getTx(tenant, req.params.transactionId);
    if (!tx) throw notFound('Transaction not found');
    if (!canSee(tx, requireClientId(req.auth))) throw forbidden('No access to this transaction');
    requireFields(req.body, ['type', 'files']);
    const files: StoredFile[] = req.body.files;
    if (!Array.isArray(files) || !files.length) throw badRequest('files must be a non-empty list');
    const docs = [...tx.supportingDocuments];
    const existing = docs.find((d) => d.type === req.body.type);
    if (existing) existing.files = [...existing.files, ...files];
    else docs.push({ type: String(req.body.type), files });
    const [updated] = await reprocess(tenant, [{ ...tx, supportingDocuments: docs }]);
    return updated;
  },

  /** Ingest a transaction for a customer (what a PSP integration would call). Amount is GBP pence. */
  'POST /transactions': async (req) => {
    requireFields(req.body, ['clientId', 'type', 'amount', 'country']);
    const customer = await getAccessibleClient(req.auth.tenant, req.body.clientId, requireClientId(req.auth));
    if (customer.kind !== 'CUSTOMER') throw badRequest('Transactions belong to customers');
    const correspondent = req.body.correspondentId ? await getCorrespondent(req.auth.tenant, req.body.correspondentId) : undefined;
    const tx = buildTransaction({
      customer,
      type: req.body.type === 'INCOMING' ? 'INCOMING' : 'OUTGOING',
      amount: Math.round(Number(req.body.amount)),
      country: String(req.body.country).toUpperCase(),
      correspondent,
    });
    const [saved] = await ingest(req.auth.tenant, [tx]);
    return saved;
  },

  /** Demo helper: a random transaction for a customer, sometimes large enough to trip a rule. */
  'POST /transactions/simulate': async (req) => {
    requireFields(req.body, ['clientId']);
    const customer = await getAccessibleClient(req.auth.tenant, req.body.clientId, requireClientId(req.auth));
    if (customer.kind !== 'CUSTOMER') throw badRequest('Transactions belong to customers');
    const type: TransactionType = req.body.type ?? (Math.random() < 0.5 ? 'INCOMING' : 'OUTGOING');
    const correspondents = type === 'OUTGOING' ? await listCorrespondentsByPsp(req.auth.tenant, customer.parentClientId!) : [];
    const correspondent = correspondents.length && Math.random() < 0.5 ? pick(correspondents, Math.random) : undefined;
    const country = correspondent?.company.jurisdiction ?? pick(['FR', 'PT', 'IT', 'ES', 'DE', 'US'], Math.random);
    const amount = Math.round((Number(req.body.amount) || 500_00 + Math.random() * 14_000_00) / 100) * 100;
    const [saved] = await ingest(req.auth.tenant, [buildTransaction({ customer, type, amount, country, correspondent })]);
    return saved;
  },

  'GET /dashboard': async (req) => {
    const all = await listFor({ ...req, query: {} });
    const onHold = all.filter((t) => t.status === 'ON_HOLD');
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const recent = all.filter((t) => t.timestamp >= since);
    const riskCounts: Record<string, number> = {};
    for (const t of onHold) for (const r of t.risks) riskCounts[r.type] = (riskCounts[r.type] ?? 0) + 1;
    return {
      onHold: { count: onHold.length, amount: onHold.reduce((s, t) => s + gbpAmount(t), 0) },
      last30Days: {
        count: recent.length,
        incoming: recent.filter((t) => t.type === 'INCOMING').reduce((s, t) => s + gbpAmount(t), 0),
        outgoing: recent.filter((t) => t.type === 'OUTGOING').reduce((s, t) => s + gbpAmount(t), 0),
      },
      riskCounts,
      latestOnHold: await withNames(req.auth.tenant, onHold.slice(0, 5)),
    };
  },
};

export async function onEvent(name: string, detail: any) {
  const tenant = detail.tenant;
  if (name === 'TxSettingsChanged') {
    await reprocess(tenant, await txsByIndex(tenant, 'GSI3', 'CLIENT', detail.clientId));
  } else if (name === 'OnboardingStatusChanged') {
    // The PSP rule depends on the PSP's onboarding status; the event carries the new status
    // because the clients service may not have stored it yet.
    const txs = await txsByIndex(tenant, 'GSI2', 'PSP', detail.clientId);
    await reprocess(tenant, txs, { clientStatus: { [detail.clientId]: detail.status } });
  }
}

export const handler = async (event: any) => {
  if (isHttpEvent(event)) return dispatch(routes, event);
  if (isEventBridgeEvent(event)) return onEvent(event['detail-type'], event.detail);
  throw new Error('Unsupported event');
};
