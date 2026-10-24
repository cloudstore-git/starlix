import { db, key, strip } from '../shared/db';
import { forbidden, notFound } from '../shared/http';
import type { Client, ClientKind, Correspondent } from '../shared/types';
import { sortKeyName } from '../shared/util';

/**
 * Clients table layout (tenant prefix omitted):
 *   Client         PK CLIENT#<id>          SK META            GSI1 PARENT#<parentId> -> <kind>#<name>#<id>
 *   Ancestor link  PK ANCESTOR#<ancestor>  SK <kind>#<name>#<clientId>     (one per ancestor in the chain)
 *   Correspondent  PK CLIENT#<pspId>       SK CORR#<id>       GSI1 ROOTCORR#<rootId> -> <name>#<id>, GSI2 CORR#<id> -> META
 */
export const clientsTable = () => process.env.CLIENTS_TABLE ?? 'clients';

const listSk = (c: Pick<Client, 'kind' | 'name' | 'id'>) => `${c.kind}#${sortKeyName(c.name)}#${c.id}`;

export async function getClient(tenant: string, id: string): Promise<Client | undefined> {
  return strip<Client>(await db().get(clientsTable(), key(tenant, 'CLIENT', id), 'META'));
}

export async function mustGetClient(tenant: string, id: string): Promise<Client> {
  const c = await getClient(tenant, id);
  if (!c) throw notFound(`Client ${id} not found`);
  return c;
}

export async function getClients(tenant: string, ids: string[]): Promise<Client[]> {
  const unique = [...new Set(ids)];
  const items = await db().batchGet(
    clientsTable(),
    unique.map((id) => ({ PK: key(tenant, 'CLIENT', id), SK: 'META' })),
  );
  return items.map((i) => strip<Client>(i));
}

export async function saveClient(tenant: string, client: Client, previous?: Client): Promise<Client> {
  const t = clientsTable();
  await db().put(t, {
    PK: key(tenant, 'CLIENT', client.id),
    SK: 'META',
    ...(client.parentClientId
      ? { GSI1PK: key(tenant, 'PARENT', client.parentClientId), GSI1SK: listSk(client) }
      : {}),
    ...client,
  });
  if (previous && listSk(previous) !== listSk(client)) {
    for (const ancestor of previous.chain) await db().delete(t, key(tenant, 'ANCESTOR', ancestor), listSk(previous));
  }
  for (const ancestor of client.chain) {
    await db().put(t, { PK: key(tenant, 'ANCESTOR', ancestor), SK: listSk(client), clientId: client.id });
  }
  return client;
}

export async function listChildren(tenant: string, parentId: string, kind?: ClientKind): Promise<Client[]> {
  const items = await db().query(clientsTable(), {
    index: 'GSI1',
    pk: key(tenant, 'PARENT', parentId),
    skPrefix: kind ? `${kind}#` : undefined,
  });
  return items.map((i) => strip<Client>(i));
}

/** All clients below an ancestor at any depth, sorted by kind then name. */
export async function listDescendants(tenant: string, ancestorId: string, kind?: ClientKind): Promise<Client[]> {
  const links = await db().query<{ clientId: string }>(clientsTable(), {
    pk: key(tenant, 'ANCESTOR', ancestorId),
    skPrefix: kind ? `${kind}#` : undefined,
  });
  const clients = await getClients(
    tenant,
    links.map((l) => l.clientId),
  );
  const order = new Map(links.map((l, i) => [l.clientId, i]));
  return clients.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

/** A caller may see its own client and anything below it. */
export function canAccess(client: Pick<Client, 'id' | 'chain'>, actingClientId: string): boolean {
  return client.id === actingClientId || client.chain.includes(actingClientId);
}

export async function getAccessibleClient(tenant: string, id: string, actingClientId: string): Promise<Client> {
  const client = await mustGetClient(tenant, id);
  if (!canAccess(client, actingClientId)) throw forbidden(`No access to client ${id}`);
  return client;
}

// ---- Correspondents ----

export async function saveCorrespondent(tenant: string, c: Correspondent): Promise<Correspondent> {
  await db().put(clientsTable(), {
    PK: key(tenant, 'CLIENT', c.clientId),
    SK: `CORR#${c.id}`,
    GSI1PK: key(tenant, 'ROOTCORR', c.rootClientId),
    GSI1SK: `${sortKeyName(c.name)}#${c.id}`,
    GSI2PK: key(tenant, 'CORR', c.id),
    GSI2SK: 'META',
    ...c,
  });
  return c;
}

export async function getCorrespondent(tenant: string, id: string): Promise<Correspondent | undefined> {
  const [item] = await db().query(clientsTable(), { index: 'GSI2', pk: key(tenant, 'CORR', id), limit: 1 });
  return item ? strip<Correspondent>(item) : undefined;
}

export async function listCorrespondentsByPsp(tenant: string, pspId: string): Promise<Correspondent[]> {
  const items = await db().query(clientsTable(), { pk: key(tenant, 'CLIENT', pspId), skPrefix: 'CORR#' });
  return items.map((i) => strip<Correspondent>(i)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listCorrespondentsByRoot(tenant: string, rootId: string): Promise<Correspondent[]> {
  const items = await db().query(clientsTable(), { index: 'GSI1', pk: key(tenant, 'ROOTCORR', rootId) });
  return items.map((i) => strip<Correspondent>(i));
}
