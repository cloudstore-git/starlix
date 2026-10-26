import { publish } from '../shared/events';
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
import { registryCompany, searchRegistry } from '../stubs/registry';
import {
  Client,
  ClientKind,
  Company,
  Correspondent,
  DEFAULT_TX_SETTINGS,
  EntityType,
  Individual,
  TxSettings,
} from '../shared/types';
import { nowIso, today, uuid } from '../shared/util';
import {
  canAccess,
  getAccessibleClient,
  getClients,
  getCorrespondent,
  listChildren,
  listCorrespondentsByPsp,
  listCorrespondentsByRoot,
  listDescendants,
  mustGetClient,
  saveClient,
  saveCorrespondent,
} from './repo';

const childKind = (parent: Client): ClientKind => (parent.kind === 'ROOT' ? 'PSP' : 'CUSTOMER');

export function newChildClient(
  parent: Client,
  input: { type: EntityType; company?: Company; individual?: Individual; uniqueReference?: string },
): Client {
  const name =
    input.type === 'COMPANY' ? input.company!.name : `${input.individual!.firstName} ${input.individual!.lastName}`.trim();
  return {
    id: uuid(),
    kind: childKind(parent),
    type: input.type,
    name,
    parentClientId: parent.id,
    chain: [...parent.chain, parent.id],
    rootClientId: parent.kind === 'ROOT' ? parent.id : parent.rootClientId,
    onboardingStatus: 'NOT_STARTED',
    company: input.company,
    individual: input.individual,
    uniqueReference: input.uniqueReference,
    incomingTxSettings: structuredClone(parent.incomingTxSettings ?? DEFAULT_TX_SETTINGS),
    outgoingTxSettings: structuredClone(parent.outgoingTxSettings ?? DEFAULT_TX_SETTINGS),
    createdAt: nowIso(),
  };
}

function companyFromBody(body: any): Company {
  if (body.registrationNumber && !body.company) {
    const found = registryCompany(String(body.registrationNumber));
    if (!found) throw notFound(`No company with registration number ${body.registrationNumber} in the registry`);
    return structuredClone(found.company);
  }
  const c = body.company;
  if (!c?.name || !c?.jurisdiction || !c?.registrationNumber) {
    throw badRequest('company.name, company.jurisdiction and company.registrationNumber are required');
  }
  return c;
}

function individualFromBody(body: any): Individual {
  const i = body.individual;
  if (!i?.firstName || !i?.lastName) throw badRequest('individual.firstName and individual.lastName are required');
  return i;
}

async function withCounts(tenant: string, clients: Client[]) {
  return Promise.all(
    clients.map(async (c) => ({
      ...c,
      customerCount: c.kind === 'PSP' ? (await listChildren(tenant, c.id)).length : undefined,
    })),
  );
}

function matches(c: Client, q?: string) {
  if (!q) return true;
  const s = q.toLowerCase();
  return c.name.toLowerCase().includes(s) || (c.uniqueReference ?? '').toLowerCase().includes(s);
}

async function addChild(req: Request, parent: Client) {
  const type: EntityType = req.body.type === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'COMPANY';
  const child = newChildClient(parent, {
    type,
    company: type === 'COMPANY' ? companyFromBody(req.body) : undefined,
    individual: type === 'INDIVIDUAL' ? individualFromBody(req.body) : undefined,
    uniqueReference: req.body.uniqueReference || undefined,
  });
  // Individual customers have nothing to onboard in the MVP: they are approved on creation.
  if (type === 'INDIVIDUAL') child.onboardingStatus = 'APPROVED';
  return saveClient(req.auth.tenant, child);
}

function validateSettings(s: any): TxSettings {
  const nums = ['maxTransactionAmount', 'requireDocsWhenGreaterThan', 'transactionTotalPerMonth', 'transactionsPerMonth'];
  for (const n of nums) {
    if (typeof s?.[n] !== 'number' || s[n] < 0) throw badRequest(`settings.${n} must be a non-negative number`);
  }
  if (!Array.isArray(s.jurisdictions)) throw badRequest('settings.jurisdictions must be a list of country codes');
  return {
    maxTransactionAmount: s.maxTransactionAmount,
    requireDocsWhenGreaterThan: s.requireDocsWhenGreaterThan,
    transactionTotalPerMonth: s.transactionTotalPerMonth,
    transactionsPerMonth: s.transactionsPerMonth,
    jurisdictions: [...new Set<string>(s.jurisdictions.map((j: string) => j.toUpperCase()))].sort(),
  };
}

export const routes: Routes = {
  'GET /psps': async (req) => {
    const me = await mustGetClient(req.auth.tenant, requireClientId(req.auth));
    const psps = (await listChildren(req.auth.tenant, me.id, 'PSP')).filter((c) => matches(c, req.query.q));
    const filtered = req.query.status ? psps.filter((p) => p.onboardingStatus === req.query.status) : psps;
    return paginate(await withCounts(req.auth.tenant, filtered), req.query);
  },

  'POST /psps': async (req) => {
    const me = await mustGetClient(req.auth.tenant, requireClientId(req.auth));
    if (me.kind !== 'ROOT') throw forbidden('Only the top-level account can add PSPs');
    return addChild({ ...req, body: { ...req.body, type: 'COMPANY' } }, me);
  },

  'GET /clients/{clientId}': async (req) => {
    const actor = requireClientId(req.auth);
    const client = await getAccessibleClient(req.auth.tenant, req.params.clientId, actor);
    // Breadcrumb: ancestors below the caller's own client
    const visibleChain = client.chain.slice(Math.max(client.chain.indexOf(actor), 0));
    const chain = (await getClients(req.auth.tenant, visibleChain)).sort(
      (a, b) => visibleChain.indexOf(a.id) - visibleChain.indexOf(b.id),
    );
    const children = client.kind === 'CUSTOMER' ? [] : await listChildren(req.auth.tenant, client.id);
    return {
      client,
      chain: chain.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
      customerCount: children.length,
    };
  },

  'GET /clients/{clientId}/customers': async (req) => {
    const parent = await getAccessibleClient(req.auth.tenant, req.params.clientId, requireClientId(req.auth));
    let items = await listChildren(req.auth.tenant, parent.id, 'CUSTOMER');
    if (req.query.type) items = items.filter((c) => c.type === req.query.type);
    return paginate(
      items.filter((c) => matches(c, req.query.q)),
      req.query,
    );
  },

  'POST /clients/{clientId}/customers': async (req) => {
    const parent = await getAccessibleClient(req.auth.tenant, req.params.clientId, requireClientId(req.auth));
    if (parent.kind !== 'PSP') throw badRequest('Customers can only be added to a PSP');
    return addChild(req, parent);
  },

  'GET /customers': async (req) => {
    const me = await mustGetClient(req.auth.tenant, requireClientId(req.auth));
    let items = await listDescendants(req.auth.tenant, me.id, 'CUSTOMER');
    if (req.query.pspId) items = items.filter((c) => c.parentClientId === req.query.pspId);
    if (req.query.type) items = items.filter((c) => c.type === req.query.type);
    items = items.filter((c) => matches(c, req.query.q));
    const psps = await getClients(req.auth.tenant, [...new Set(items.map((c) => c.parentClientId!))]);
    const pspNames = new Map(psps.map((p) => [p.id, p.name]));
    return paginate(
      items.map((c) => ({ ...c, pspName: pspNames.get(c.parentClientId!) })),
      req.query,
    );
  },

  'PUT /clients/{clientId}/tx-settings/{direction}': async (req) => {
    const client = await getAccessibleClient(req.auth.tenant, req.params.clientId, requireClientId(req.auth));
    if (client.id === req.auth.clientId) throw forbidden('You cannot change your own limits');
    const direction = req.params.direction.toUpperCase();
    if (direction !== 'INCOMING' && direction !== 'OUTGOING') throw badRequest('direction must be incoming or outgoing');
    const settings = validateSettings(req.body.settings);
    const updated: Client = {
      ...client,
      ...(direction === 'INCOMING' ? { incomingTxSettings: settings } : { outgoingTxSettings: settings }),
    };
    await saveClient(req.auth.tenant, updated, client);
    if (req.body.reprocessTransactions !== false) {
      await publish('TxSettingsChanged', { tenant: req.auth.tenant, clientId: client.id });
    }
    return updated;
  },

  'GET /registry/search': async (req) => searchRegistry(req.query.q ?? ''),

  'GET /registry/{registrationNumber}': async (req) => {
    const found = registryCompany(req.params.registrationNumber);
    if (!found) throw notFound('Company not found in registry');
    return found;
  },

  'GET /correspondents': async (req) => {
    const me = await mustGetClient(req.auth.tenant, requireClientId(req.auth));
    let items: Correspondent[] =
      me.kind === 'ROOT'
        ? await listCorrespondentsByRoot(req.auth.tenant, me.id)
        : await listCorrespondentsByPsp(req.auth.tenant, me.id);
    if (req.query.pspId) items = items.filter((c) => c.clientId === req.query.pspId);
    const psps = await getClients(req.auth.tenant, [...new Set(items.map((c) => c.clientId))]);
    const names = new Map(psps.map((p) => [p.id, p.name]));
    const t = today();
    return paginate(
      items.map((c) => ({ ...c, pspName: names.get(c.clientId), licenseExpired: c.licenseExpires < t })),
      req.query,
    );
  },

  'GET /correspondents/{correspondentId}': async (req) => {
    const c = await getCorrespondent(req.auth.tenant, req.params.correspondentId);
    if (!c) throw notFound('Correspondent not found');
    const psp = await getAccessibleClient(req.auth.tenant, c.clientId, requireClientId(req.auth));
    return { correspondent: { ...c, licenseExpired: c.licenseExpires < today() }, psp: { id: psp.id, name: psp.name } };
  },

  'POST /clients/{clientId}/correspondents': async (req) => {
    const psp = await getAccessibleClient(req.auth.tenant, req.params.clientId, requireClientId(req.auth));
    if (psp.kind !== 'PSP') throw badRequest('Correspondents belong to a PSP');
    requireFields(req.body, ['type', 'licenseExpires']);
    const company = companyFromBody(req.body);
    const c: Correspondent = {
      id: uuid(),
      type: req.body.type === 'BANK' ? 'BANK' : 'PARTNER',
      company,
      name: company.name,
      onboardingStatus: 'APPROVED',
      clientId: psp.id,
      rootClientId: psp.rootClientId,
      licenseExpires: String(req.body.licenseExpires),
      licenseDocuments: req.body.licenseDocuments ?? [],
      corridors: req.body.corridors ?? [],
      iban: req.body.iban,
    };
    return saveCorrespondent(req.auth.tenant, c);
  },
};

export async function onEvent(name: string, detail: any) {
  if (name === 'OnboardingStatusChanged') {
    const client = await mustGetClient(detail.tenant, detail.clientId);
    await saveClient(detail.tenant, { ...client, onboardingStatus: detail.status }, client);
  }
}

export const handler = async (event: any) => {
  if (isHttpEvent(event)) return dispatch(routes, event);
  if (isEventBridgeEvent(event)) return onEvent(event['detail-type'], event.detail);
  throw new Error('Unsupported event');
};

export { canAccess };
