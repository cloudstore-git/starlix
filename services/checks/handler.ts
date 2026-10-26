import { db, key, strip } from '../shared/db';
import { EventMap, publish } from '../shared/events';
import { Routes, dispatch, forbidden, isEventBridgeEvent, isHttpEvent, requireClientId } from '../shared/http';
import type { EntityCheck } from '../shared/types';
import { nowIso, sleep, uuid } from '../shared/util';
import { runStubCheck } from '../stubs/kyc';
import { canAccess, mustGetClient } from '../clients/repo';

/**
 * Checks table layout (tenant prefix omitted):
 *   Check  PK FORM#<formId>  SK CHECK#<section>#<entityId>   (+ clientId for access control)
 */
const table = () => process.env.CHECKS_TABLE ?? 'checks';
const stepDelay = () => Number(process.env.STUB_DELAY_MS ?? 800);

type StoredCheck = EntityCheck & { clientId: string };

async function listChecks(tenant: string, formId: string): Promise<StoredCheck[]> {
  const items = await db().query(table(), { pk: key(tenant, 'FORM', formId), skPrefix: 'CHECK#' });
  return items.map((i) => strip<StoredCheck>(i));
}

async function saveCheck(tenant: string, check: StoredCheck) {
  await db().put(table(), {
    PK: key(tenant, 'FORM', check.formId),
    SK: `CHECK#${check.sectionName}#${check.entity.id}`,
    ...check,
  });
}

/** Runs every planned check of a submitted form against the stub providers, then reports one summary event. */
export async function runChecks(detail: EventMap['OnboardingSubmitted']) {
  const { tenant, formId, clientId } = detail;
  // A resubmission replaces earlier results
  for (const old of await listChecks(tenant, formId)) {
    await db().delete(table(), key(tenant, 'FORM', formId), `CHECK#${old.sectionName}#${old.entity.id}`);
  }
  const checks: StoredCheck[] = detail.checks.map((c) => ({
    id: uuid(),
    formId,
    clientId,
    sectionName: c.sectionName,
    entity: c.entity,
    level: c.level,
    status: 'IN_PROGRESS',
    startedAt: nowIso(),
  }));
  for (const c of checks) await saveCheck(tenant, c);

  const summary = { tenant, formId, total: checks.length, passed: 0, failed: 0, errors: 0 };
  for (const c of checks) {
    await sleep(stepDelay());
    const result = runStubCheck(c.entity, c.level);
    await saveCheck(tenant, { ...c, status: result.status, message: result.message, expiry: result.expiry, finishedAt: nowIso() });
    if (result.status === 'PASSED') summary.passed++;
    else if (result.status === 'FAILED') summary.failed++;
    else summary.errors++;
  }
  await publish('ChecksCompleted', summary);
  return summary;
}

export const routes: Routes = {
  'GET /onboarding/{formId}/checks': async (req) => {
    const checks = await listChecks(req.auth.tenant, req.params.formId);
    if (!checks.length) return [];
    const client = await mustGetClient(req.auth.tenant, checks[0].clientId);
    if (!canAccess(client, requireClientId(req.auth))) throw forbidden('No access to these checks');
    return checks.map(({ clientId: _c, ...c }) => c);
  },
};

export const handler = async (event: any) => {
  if (isHttpEvent(event)) return dispatch(routes, event);
  if (isEventBridgeEvent(event) && event['detail-type'] === 'OnboardingSubmitted') return runChecks(event.detail);
  throw new Error('Unsupported event');
};
