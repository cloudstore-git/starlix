import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminListGroupsForUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomInt } from 'crypto';

const client = new CognitoIdentityProviderClient({});
const pool = () => process.env.USER_POOL_ID!;

/** LOCAL_USERS=1 swaps Cognito for an in-memory directory, used by the local dev server (scripts/local.ts). */
const isLocal = () => process.env.LOCAL_USERS === '1';

export interface LocalUser {
  username: string;
  email: string;
  tenant: string;
  clientId?: string;
  accountId?: string;
  enabled: boolean;
  status: string;
  createdAt: string;
  groups: string[];
}

export const localUsers = new Map<string, LocalUser>();

function localUser(username: string): LocalUser {
  const u = localUsers.get(username);
  if (!u) throw Object.assign(new Error('User does not exist'), { name: 'UserNotFoundException' });
  return u;
}

export interface NewUser {
  email: string;
  group: 'ADMIN' | 'USER';
  tenant: string;
  clientId?: string;
  accountId?: string;
  /** Set a permanent password (demo users); otherwise Cognito emails a temporary one. */
  password?: string;
}

/** Meets the pool policy: upper, lower, digit, symbol, 12+ chars. */
export function temporaryPassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%&*?'];
  const chars = sets.map((s) => s[randomInt(s.length)]);
  const all = sets.join('');
  while (chars.length < 14) chars.push(all[randomInt(all.length)]);
  return chars.sort(() => randomInt(3) - 1).join('');
}

export async function createUser(u: NewUser): Promise<{ username: string; temporaryPassword?: string }> {
  const temp = u.password ? undefined : temporaryPassword();
  if (isLocal()) {
    if (localUsers.has(u.email)) throw Object.assign(new Error('User exists'), { name: 'UsernameExistsException' });
    localUsers.set(u.email, {
      username: u.email,
      email: u.email,
      tenant: u.tenant,
      clientId: u.clientId,
      accountId: u.accountId,
      enabled: true,
      status: u.password ? 'CONFIRMED' : 'FORCE_CHANGE_PASSWORD',
      createdAt: new Date().toISOString(),
      groups: [u.group],
    });
    return { username: u.email, temporaryPassword: temp };
  }
  const attrs = [
    { Name: 'email', Value: u.email },
    { Name: 'email_verified', Value: 'true' },
    { Name: 'custom:tenant', Value: u.tenant },
    ...(u.clientId ? [{ Name: 'custom:clientId', Value: u.clientId }] : []),
    ...(u.accountId ? [{ Name: 'custom:accountId', Value: u.accountId }] : []),
  ];
  const res = await client.send(
    new AdminCreateUserCommand({
      UserPoolId: pool(),
      Username: u.email,
      UserAttributes: attrs,
      TemporaryPassword: temp ?? temporaryPassword(),
      DesiredDeliveryMediums: ['EMAIL'],
      MessageAction: u.password ? 'SUPPRESS' : undefined,
    }),
  );
  const username = res.User!.Username!;
  await client.send(new AdminAddUserToGroupCommand({ UserPoolId: pool(), Username: username, GroupName: u.group }));
  if (u.password) {
    await client.send(new AdminSetUserPasswordCommand({ UserPoolId: pool(), Username: username, Password: u.password, Permanent: true }));
  }
  return { username, temporaryPassword: temp };
}

const attr = (u: UserType, name: string) => u.Attributes?.find((a) => a.Name === name)?.Value;

export async function listUsers() {
  if (isLocal()) return [...localUsers.values()].map((u) => ({ ...u }));
  const users: UserType[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(new ListUsersCommand({ UserPoolId: pool(), PaginationToken: token }));
    users.push(...(res.Users ?? []));
    token = res.PaginationToken;
  } while (token);
  return Promise.all(
    users.map(async (u) => {
      const groups = await client.send(new AdminListGroupsForUserCommand({ UserPoolId: pool(), Username: u.Username! }));
      return {
        username: u.Username!,
        email: attr(u, 'email'),
        tenant: attr(u, 'custom:tenant'),
        clientId: attr(u, 'custom:clientId'),
        enabled: u.Enabled,
        status: u.UserStatus,
        createdAt: u.UserCreateDate?.toISOString(),
        groups: (groups.Groups ?? []).map((g) => g.GroupName!),
      };
    }),
  );
}

export async function setEnabled(username: string, enabled: boolean) {
  if (isLocal()) {
    localUser(username).enabled = enabled;
    return;
  }
  const Cmd = enabled ? AdminEnableUserCommand : AdminDisableUserCommand;
  await client.send(new Cmd({ UserPoolId: pool(), Username: username }));
}

export async function deleteUser(username: string) {
  if (isLocal()) {
    localUsers.delete(localUser(username).username);
    return;
  }
  await client.send(new AdminDeleteUserCommand({ UserPoolId: pool(), Username: username }));
}

/** Re-points an existing user at a client (used when the demo is reset and clients get new ids). */
export async function updateUserLink(username: string, tenant: string, clientId?: string, accountId?: string, password?: string) {
  if (isLocal()) {
    Object.assign(localUser(username), { tenant, ...(clientId ? { clientId } : {}), ...(accountId ? { accountId } : {}) });
    return;
  }
  const attrs = [
    { Name: 'custom:tenant', Value: tenant },
    ...(clientId ? [{ Name: 'custom:clientId', Value: clientId }] : []),
    ...(accountId ? [{ Name: 'custom:accountId', Value: accountId }] : []),
  ];
  await client.send(new AdminUpdateUserAttributesCommand({ UserPoolId: pool(), Username: username, UserAttributes: attrs }));
  if (password) {
    await client.send(new AdminSetUserPasswordCommand({ UserPoolId: pool(), Username: username, Password: password, Permanent: true }));
  }
}
