import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';

export interface AuthContext {
  userId: string;
  email: string;
  tenant: string;
  clientId?: string;
  accountId?: string;
  groups: string[];
  isAdmin: boolean;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what);
export const forbidden = (what = 'Forbidden') => new HttpError(403, what);
export const badRequest = (what: string) => new HttpError(400, what);

export interface Request {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
  auth: AuthContext;
}

export type RouteHandler = (req: Request) => Promise<any>;
export type Routes = Record<string, RouteHandler>;

export function authFromEvent(event: APIGatewayProxyEventV2WithJWTAuthorizer): AuthContext {
  const claims = (event.requestContext?.authorizer?.jwt?.claims ?? {}) as Record<string, any>;
  const rawGroups = claims['cognito:groups'];
  const groups: string[] = Array.isArray(rawGroups)
    ? rawGroups
    : typeof rawGroups === 'string'
      ? rawGroups.replace(/^\[|\]$/g, '').split(/[ ,]+/).filter(Boolean)
      : [];
  return {
    userId: String(claims.sub ?? ''),
    email: String(claims.email ?? ''),
    tenant: String(claims['custom:tenant'] ?? process.env.DEFAULT_TENANT ?? 'default'),
    clientId: claims['custom:clientId'] ? String(claims['custom:clientId']) : undefined,
    accountId: claims['custom:accountId'] ? String(claims['custom:accountId']) : undefined,
    groups,
    isAdmin: groups.includes('ADMIN'),
  };
}

/** The client the caller acts as. Admins and users without a client cannot use client-scoped routes. */
export function requireClientId(auth: AuthContext): string {
  if (!auth.clientId) throw forbidden('Your user is not linked to a client');
  return auth.clientId;
}

export function requireAdmin(auth: AuthContext) {
  if (!auth.isAdmin) throw forbidden('Admin only');
}

export function json(status: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

/**
 * Dispatches an HTTP API (payload v2) event to a route keyed by API Gateway's routeKey,
 * e.g. "GET /psps/{clientId}".
 */
export async function dispatch(
  routes: Routes,
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const handler = routes[event.routeKey];
  if (!handler) return json(404, { message: `No route for ${event.routeKey}` });
  let body: any = undefined;
  if (event.body) {
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
      body = JSON.parse(raw);
    } catch {
      return json(400, { message: 'Body must be JSON' });
    }
  }
  try {
    const result = await handler({
      method: event.requestContext.http.method,
      path: event.rawPath,
      params: (event.pathParameters ?? {}) as Record<string, string>,
      query: (event.queryStringParameters ?? {}) as Record<string, string>,
      body: body ?? {},
      auth: authFromEvent(event),
    });
    return json(result === undefined ? 204 : 200, result);
  } catch (e: any) {
    if (e instanceof HttpError) return json(e.status, { message: e.message });
    console.error('Unhandled error', e);
    return json(500, { message: 'Internal error' });
  }
}

export function isHttpEvent(event: any): event is APIGatewayProxyEventV2WithJWTAuthorizer {
  return typeof event?.routeKey === 'string';
}

export function isEventBridgeEvent(event: any): event is { 'detail-type': string; detail: any; source: string } {
  return typeof event?.['detail-type'] === 'string';
}

export function requireFields(body: any, fields: string[]) {
  const missing = fields.filter((f) => body?.[f] === undefined || body?.[f] === null || body?.[f] === '');
  if (missing.length) throw badRequest(`Missing fields: ${missing.join(', ')}`);
}

/** Simple page slicing for list endpoints: ?page=0&size=20 */
export function paginate<T>(items: T[], query: Record<string, string>) {
  const size = Math.min(Math.max(Number(query.size ?? 20) || 20, 1), 200);
  const page = Math.max(Number(query.page ?? 0) || 0, 0);
  return {
    items: items.slice(page * size, page * size + size),
    page,
    size,
    total: items.length,
    totalPages: Math.max(1, Math.ceil(items.length / size)),
  };
}
