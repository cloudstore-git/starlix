/**
 * Runs the whole backend in one Node process for local development and demos without AWS:
 * an in-memory database, events delivered in-process (like the EventBridge rules), an in-memory
 * user directory instead of Cognito and files kept in memory instead of S3.
 *
 *   npm run local            # API on http://localhost:4000
 *   cd web && npm run dev:local
 *
 * The web app signs in with any seeded email and any password in this mode.
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { MemoryDb, setDb } from '../services/shared/db';
import { setEventSink } from '../services/shared/events';
import { AuthContext, HttpError, Routes } from '../services/shared/http';
import * as clients from '../services/clients/handler';
import * as onboarding from '../services/onboarding/handler';
import * as checks from '../services/checks/handler';
import * as transactions from '../services/transactions/handler';
import * as identity from '../services/identity/handler';
import { safeName } from '../services/files/handler';
import { localUsers } from '../services/identity/cognito';
import { seed, setSeedFileWriter } from '../services/seed/handler';
import { deliverInProcess } from '../services/seed/in-process';
import { uuid } from '../services/shared/util';

const PORT = Number(process.env.PORT ?? 4000);
const TENANT = 'default';

Object.assign(process.env, {
  LOCAL_USERS: '1',
  USER_POOL_ID: 'local',
  DEFAULT_TENANT: TENANT,
  STUB_DELAY_MS: process.env.STUB_DELAY_MS ?? '700',
  IDENTITY_TABLE: 'identity',
  CLIENTS_TABLE: 'clients',
  ONBOARDING_TABLE: 'onboarding',
  CHECKS_TABLE: 'checks',
  TRANSACTIONS_TABLE: 'transactions',
});

setDb(new MemoryDb());

// Delivered after the publishing request returns, like EventBridge
setEventSink(async (name, detail: any) => {
  setTimeout(async () => {
    try {
      await deliverInProcess(name, detail);
    } catch (e) {
      console.error(`Event ${name} failed`, e);
    }
  }, 50);
});

const files = new Map<string, { body: Buffer; type: string }>();
const base = `http://localhost:${PORT}`;
setSeedFileWriter(async (key, body, type) => {
  files.set(key, { body: Buffer.from(body), type });
});

const fileRoutes: Routes = {
  'POST /files/upload-url': async (req) => {
    const name = safeName(String(req.body.fileName ?? 'file'));
    const key = `t/${req.auth.tenant}/${uuid()}/${name}`;
    return { key, name, url: `${base}/_files/${encodeURIComponent(key)}` };
  },
  'GET /files/download-url': async (req) => ({ url: `${base}/_files/${encodeURIComponent(String(req.query.key))}` }),
};

const ALL: Routes = { ...clients.routes, ...onboarding.routes, ...checks.routes, ...transactions.routes, ...identity.routes, ...fileRoutes };

const matchers = Object.keys(ALL).map((routeKey) => {
  const [method, path] = routeKey.split(' ');
  const names: string[] = [];
  const re = new RegExp('^' + path.replace(/\{(\w+)\}/g, (_, n) => (names.push(n), '([^/]+)')) + '$');
  return { routeKey, method, re, names };
});

function authFor(header: string | undefined): AuthContext | undefined {
  const email = header?.startsWith('Local ') ? header.slice(6).trim().toLowerCase() : undefined;
  const u = email ? localUsers.get(email) : undefined;
  if (!u || !u.enabled) return undefined;
  return { userId: u.username, email: u.email, tenant: u.tenant, clientId: u.clientId, accountId: u.accountId, groups: u.groups, isAdmin: u.groups.includes('ADMIN') };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization,content-type');
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  const url = new URL(req.url ?? '/', base);

  if (url.pathname === '/config.json') {
    return send(res, 200, { apiUrl: base, region: 'local', userPoolId: 'local', userPoolClientId: 'local', stage: 'local', localAuth: true });
  }
  if (url.pathname.startsWith('/_files/')) {
    const key = decodeURIComponent(url.pathname.slice(8));
    if (req.method === 'PUT') {
      files.set(key, { body: await readBody(req), type: String(req.headers['content-type'] ?? 'application/octet-stream') });
      return res.end();
    }
    const f = files.get(key);
    if (!f) return send(res, 404, { message: 'No such file' });
    res.writeHead(200, { 'content-type': f.type });
    return res.end(f.body);
  }

  const m = matchers.map((x) => ({ x, hit: req.method === x.method ? x.re.exec(url.pathname) : null })).find((r) => r.hit);
  if (!m?.hit) return send(res, 404, { message: `No route for ${req.method} ${url.pathname}` });
  const auth = authFor(req.headers.authorization);
  if (!auth) return send(res, 401, { message: 'Unauthorized' });
  const raw = (await readBody(req)).toString('utf8');
  let body: any = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return send(res, 400, { message: 'Body must be JSON' });
  }
  const params = Object.fromEntries(m.x.names.map((n, i) => [n, decodeURIComponent(m.hit![i + 1])]));
  try {
    const result = await ALL[m.x.routeKey]({ method: m.x.method, path: url.pathname, params, query: Object.fromEntries(url.searchParams), body, auth });
    send(res, result === undefined ? 204 : 200, result);
  } catch (e: any) {
    if (e instanceof HttpError) return send(res, e.status, { message: e.message });
    console.error(e);
    send(res, 500, { message: 'Internal error' });
  }
});

seed({ tenant: TENANT, demoPassword: 'local', adminEmail: 'admin@starlix.demo' }).then((r: any) => {
  server.listen(PORT, () => {
    console.log(`Starlix local API on ${base} (${r.transactions} transactions, ${r.onHold} on hold)`);
    console.log(`Sign in with any password as: ${[...localUsers.keys()].join(', ')}`);
  });
});
