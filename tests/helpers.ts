import { MemoryDb, setDb } from '../services/shared/db';
import { setEventSink } from '../services/shared/events';
import type { AuthContext, Request, Routes } from '../services/shared/http';
import * as clients from '../services/clients/handler';
import * as onboarding from '../services/onboarding/handler';
import * as checks from '../services/checks/handler';
import * as transactions from '../services/transactions/handler';
import * as identity from '../services/identity/handler';
import { deliverInProcess } from '../services/seed/in-process';

export const TENANT = 'test';

/** Fresh in-memory database with events delivered in-process, like the EventBridge rules in the CDK stack. */
export function setup() {
  process.env.STUB_DELAY_MS = '0';
  process.env.IDENTITY_TABLE = 'identity';
  process.env.CLIENTS_TABLE = 'clients';
  process.env.ONBOARDING_TABLE = 'onboarding';
  process.env.CHECKS_TABLE = 'checks';
  process.env.TRANSACTIONS_TABLE = 'transactions';
  const memory = new MemoryDb();
  setDb(memory);
  const published: { name: string; detail: any }[] = [];
  setEventSink(async (name, detail: any) => {
    published.push({ name, detail });
    await deliverInProcess(name, detail);
  });
  return { memory, published };
}

export function auth(clientId?: string, extra: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: `user-${clientId ?? 'admin'}`,
    email: 'tester@example.com',
    tenant: TENANT,
    clientId,
    groups: extra.isAdmin ? ['ADMIN'] : ['USER'],
    isAdmin: false,
    ...extra,
  };
}

const ALL: Routes = { ...clients.routes, ...onboarding.routes, ...checks.routes, ...transactions.routes, ...identity.routes };

/** Calls a route handler directly, e.g. call('GET /psps', a, { query: { q: 'cash' } }) */
export async function call(route: string, a: AuthContext, r: Partial<Omit<Request, 'auth'>> = {}): Promise<any> {
  const h = ALL[route];
  if (!h) throw new Error(`No route ${route}`);
  return h({ method: route.split(' ')[0], path: route.split(' ')[1], params: {}, query: {}, body: {}, ...r, auth: a });
}

export async function expectHttpError(p: Promise<any>, status: number) {
  try {
    await p;
  } catch (e: any) {
    if (e.status === status) return e;
    throw new Error(`Expected HTTP ${status} but got ${e.status}: ${e.message}`);
  }
  throw new Error(`Expected HTTP ${status} but the call succeeded`);
}
