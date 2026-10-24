import { db, key, strip } from '../shared/db';
import { publish } from '../shared/events';
import {
  Routes,
  badRequest,
  dispatch,
  forbidden,
  requireAdmin,
  requireClientId,
  requireFields,
} from '../shared/http';
import { nowIso, uuid } from '../shared/util';
import { getAccessibleClient, getClient, mustGetClient } from '../clients/repo';
import { createUser, deleteUser, listUsers, setEnabled } from './cognito';

/**
 * Identity table layout (tenant prefix omitted):
 *   Account       PK ACCOUNT#<id>   SK META   GSI1 CLIENT#<clientId> -> ACCOUNT, GSI2 ACCOUNTS -> <name>
 *   User profile  PK USER#<sub>     SK META   GSI1 ACCOUNT#<accountId> -> USER#<email>
 *   Branding      PK TENANT         SK META
 */
const table = () => process.env.IDENTITY_TABLE ?? 'identity';

export interface Account {
  id: string;
  name: string;
  clientId: string;
  createdAt: string;
}

export interface Branding {
  name: string;
  logo: string;
  primaryColor: string;
}

const DEFAULT_BRANDING: Branding = { name: 'StarLiX', logo: '/images/logo.svg', primaryColor: '#1e40af' };

export async function saveAccount(tenant: string, a: Account) {
  await db().put(table(), {
    PK: key(tenant, 'ACCOUNT', a.id),
    SK: 'META',
    GSI1PK: key(tenant, 'CLIENT', a.clientId),
    GSI1SK: 'ACCOUNT',
    GSI2PK: key(tenant, 'ACCOUNTS'),
    GSI2SK: `${a.name.toLowerCase()}#${a.id}`,
    ...a,
  });
  return a;
}

export async function accountForClient(tenant: string, clientId: string): Promise<Account | undefined> {
  const [item] = await db().query(table(), { index: 'GSI1', pk: key(tenant, 'CLIENT', clientId), limit: 1 });
  return item ? strip<Account>(item) : undefined;
}

export async function saveBranding(tenant: string, b: Branding) {
  await db().put(table(), { PK: key(tenant, 'TENANT'), SK: 'META', ...b });
}

async function branding(tenant: string): Promise<Branding> {
  return strip<Branding>(await db().get(table(), key(tenant, 'TENANT'), 'META')) ?? DEFAULT_BRANDING;
}

export const routes: Routes = {
  /** Who am I: user, client, account and tenant branding. Also marks invited users as signed up. */
  'GET /me': async (req) => {
    const { tenant, userId, clientId } = req.auth;
    const client = clientId ? await getClient(tenant, clientId) : undefined;
    const profileKey = key(tenant, 'USER', userId);
    const profile = await db().get<any>(table(), profileKey, 'META');
    if (!profile && clientId) {
      await db().put(table(), {
        PK: profileKey,
        SK: 'META',
        GSI1PK: key(tenant, 'ACCOUNT', req.auth.accountId ?? 'none'),
        GSI1SK: `USER#${req.auth.email}`,
        email: req.auth.email,
        clientId,
        activatedAt: nowIso(),
      });
      await publish('UserActivated', { tenant, clientId, email: req.auth.email });
    }
    const onboardingRequired =
      !!client && client.kind !== 'ROOT' && !['APPROVED', 'EXPIRING'].includes(client.onboardingStatus);
    return {
      user: { id: userId, email: req.auth.email, groups: req.auth.groups, isAdmin: req.auth.isAdmin },
      client: client ?? null,
      account: clientId ? ((await accountForClient(tenant, clientId)) ?? null) : null,
      onboardingRequired,
      branding: await branding(tenant),
    };
  },

  /** Gives a client (usually a PSP being onboarded) a login. Returns the temporary password for the demo. */
  'POST /invites': async (req) => {
    requireFields(req.body, ['clientId', 'email']);
    const actor = requireClientId(req.auth);
    const client = await getAccessibleClient(req.auth.tenant, req.body.clientId, actor);
    if (client.id === actor) throw forbidden('You cannot invite yourself');
    if (client.type !== 'COMPANY') throw badRequest('Only company clients get logins');
    const account =
      (await accountForClient(req.auth.tenant, client.id)) ??
      (await saveAccount(req.auth.tenant, { id: uuid(), name: client.name, clientId: client.id, createdAt: nowIso() }));
    try {
      const user = await createUser({
        email: String(req.body.email).trim().toLowerCase(),
        group: 'USER',
        tenant: req.auth.tenant,
        clientId: client.id,
        accountId: account.id,
      });
      return { email: req.body.email, temporaryPassword: user.temporaryPassword, accountId: account.id };
    } catch (e: any) {
      if (e?.name === 'UsernameExistsException') throw badRequest('A user with this email already exists');
      throw e;
    }
  },

  'GET /admin/users': async (req) => {
    requireAdmin(req.auth);
    const users = await listUsers();
    return Promise.all(
      users.map(async (u) => ({
        ...u,
        clientName: u.clientId && u.tenant ? (await getClient(u.tenant, u.clientId))?.name : undefined,
      })),
    );
  },

  'POST /admin/users': async (req) => {
    requireAdmin(req.auth);
    requireFields(req.body, ['email', 'role']);
    const role = req.body.role === 'ADMIN' ? 'ADMIN' : 'USER';
    let clientId: string | undefined;
    let accountId: string | undefined;
    if (role === 'USER') {
      requireFields(req.body, ['clientId']);
      const client = await mustGetClient(req.auth.tenant, req.body.clientId);
      clientId = client.id;
      accountId = (await accountForClient(req.auth.tenant, client.id))?.id;
    }
    try {
      return await createUser({ email: String(req.body.email).trim().toLowerCase(), group: role, tenant: req.auth.tenant, clientId, accountId });
    } catch (e: any) {
      if (e?.name === 'UsernameExistsException') throw badRequest('A user with this email already exists');
      throw e;
    }
  },

  'POST /admin/users/{username}/disable': async (req) => {
    requireAdmin(req.auth);
    await setEnabled(req.params.username, false);
  },

  'POST /admin/users/{username}/enable': async (req) => {
    requireAdmin(req.auth);
    await setEnabled(req.params.username, true);
  },

  'DELETE /admin/users/{username}': async (req) => {
    requireAdmin(req.auth);
    if (req.params.username === req.auth.userId || req.params.username === req.auth.email) throw badRequest('You cannot delete yourself');
    await deleteUser(req.params.username);
  },

  'GET /admin/accounts': async (req) => {
    requireAdmin(req.auth);
    const items = await db().query(table(), { index: 'GSI2', pk: key(req.auth.tenant, 'ACCOUNTS') });
    return items.map((r) => strip<Account>(r));
  },
};

export const handler = async (event: any) => dispatch(routes, event);
