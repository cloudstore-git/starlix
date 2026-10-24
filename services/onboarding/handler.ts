import { db, key, strip } from '../shared/db';
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
  requireClientId,
} from '../shared/http';
import {
  Director,
  OnboardingForm,
  OnboardingNote,
  OnboardingSection,
  OnboardingStatus,
  Shareholder,
  entityFromIndividual,
} from '../shared/types';
import { nowIso, uuid } from '../shared/util';
import { registryCompany } from '../stubs/registry';
import { canAccess, getAccessibleClient, mustGetClient } from '../clients/repo';
import {
  ReviewResult,
  SECTIONS,
  allSectionsCompleted,
  buildRequirements,
  canEdit,
  canReview,
  expiryStatus,
  missingFields,
  plannedChecks,
  statusAfterChecks,
  statusAfterReview,
  statusAfterSubmit,
} from '../domain/onboarding';

/**
 * Onboarding table layout (tenant prefix omitted):
 *   Form     PK FORM#<id>  SK META            GSI1 CLIENT#<clientId> -> FORM#<createdAt>
 *                                            GSI2 CREATOR#<clientId> -> <createdAt>
 *                                            GSI3 ALLFORMS (global) -> <tenant>#<id>   (expiry scan)
 *   Section  PK FORM#<id>  SK SECTION#<name>
 *   Note     PK FORM#<id>  SK NOTE#<timestamp>
 */
const table = () => process.env.ONBOARDING_TABLE ?? 'onboarding';
const CLOSED: OnboardingStatus[] = ['REJECTED', 'EXPIRED'];

async function saveForm(tenant: string, form: OnboardingForm) {
  await db().put(table(), {
    PK: key(tenant, 'FORM', form.id),
    SK: 'META',
    GSI1PK: key(tenant, 'CLIENT', form.clientId),
    GSI1SK: `FORM#${form.createdAt}`,
    GSI2PK: key(tenant, 'CREATOR', form.createdByClientId),
    GSI2SK: form.createdAt,
    GSI3PK: 'ALLFORMS',
    GSI3SK: `${tenant}#${form.id}`,
    tenant,
    ...form,
  });
  return form;
}

async function getForm(tenant: string, id: string): Promise<OnboardingForm | undefined> {
  const item = await db().get(table(), key(tenant, 'FORM', id), 'META');
  if (!item) return undefined;
  const { tenant: _t, ...form } = strip<any>(item);
  return form as OnboardingForm;
}

async function latestFormForClient(tenant: string, clientId: string): Promise<OnboardingForm | undefined> {
  const [item] = await db().query(table(), {
    index: 'GSI1',
    pk: key(tenant, 'CLIENT', clientId),
    forward: false,
    limit: 1,
  });
  return item ? (await getForm(tenant, strip<OnboardingForm>(item).id)) : undefined;
}

async function getSections(tenant: string, formId: string): Promise<OnboardingSection[]> {
  const items = await db().query(table(), { pk: key(tenant, 'FORM', formId), skPrefix: 'SECTION#' });
  return items.map((i) => strip<OnboardingSection>(i));
}

async function saveSection(tenant: string, section: OnboardingSection) {
  await db().put(table(), { PK: key(tenant, 'FORM', section.formId), SK: `SECTION#${section.name}`, ...section });
}

async function getNotes(tenant: string, formId: string): Promise<OnboardingNote[]> {
  const items = await db().query(table(), { pk: key(tenant, 'FORM', formId), skPrefix: 'NOTE#' });
  return items.map((i) => strip<OnboardingNote>(i));
}

async function addNote(req: Request, formId: string, comment: string, relevantSectionNames: string[] = []) {
  const note: OnboardingNote = {
    authorEmail: req.auth.email,
    authorUserId: req.auth.userId,
    comment,
    timestamp: nowIso(),
    relevantSectionNames,
  };
  await db().put(table(), { PK: key(req.auth.tenant, 'FORM', formId), SK: `NOTE#${note.timestamp}#${uuid()}`, ...note });
  return note;
}

async function setStatus(tenant: string, form: OnboardingForm, status: OnboardingStatus, extra: Partial<OnboardingForm> = {}) {
  const updated = { ...form, ...extra, status };
  if (status === 'APPROVED' && form.status !== 'APPROVED') updated.approvedAt = nowIso();
  await saveForm(tenant, updated);
  if (status !== form.status) {
    await publish('OnboardingStatusChanged', { tenant, formId: form.id, clientId: form.clientId, status });
  }
  return updated;
}

/** Used by the seed to put demo forms into states the normal flow only reaches over time (e.g. EXPIRED). */
export async function seedFormStatus(tenant: string, formId: string, status: OnboardingStatus, extra: Partial<OnboardingForm> = {}) {
  const form = await getForm(tenant, formId);
  if (!form) throw notFound('Onboarding form not found');
  return setStatus(tenant, form, status, extra);
}

/** Loads a form the caller may see: the onboarding client itself or any client above it. */
async function accessibleForm(req: Request): Promise<OnboardingForm> {
  const form = await getForm(req.auth.tenant, req.params.formId);
  if (!form) throw notFound('Onboarding form not found');
  const client = await mustGetClient(req.auth.tenant, form.clientId);
  if (!canAccess(client, requireClientId(req.auth))) throw forbidden('No access to this onboarding form');
  return form;
}

/** Ticking "shareholder" on a director keeps a matching shareholder entry, as in the original app. */
export function syncDirectorShareholders(directors: Director[], shareholders: Shareholder[]): Shareholder[] {
  const byDirector = new Map(directors.map((d) => [d.id, d]));
  const kept = shareholders.filter((s) => !s.directorId || byDirector.get(s.directorId)?.shareholder);
  for (const d of directors) {
    if (d.shareholder && !kept.some((s) => s.directorId === d.id)) {
      kept.push({ id: uuid(), entity: d.entity, directorId: d.id, source: 'director' });
    }
  }
  return kept;
}

async function prefill(tenant: string, form: OnboardingForm) {
  const client = await mustGetClient(tenant, form.clientId);
  if (!client.company) return;
  const names = form.requirements.map((r) => r.sectionName);
  if (names.includes(SECTIONS.COMPANY_INFO.name)) {
    await saveSection(tenant, { formId: form.id, name: SECTIONS.COMPANY_INFO.name, data: { company: client.company }, updatedAt: nowIso() });
  }
  const reg = registryCompany(client.company.registrationNumber);
  if (reg && names.includes(SECTIONS.DIRECTORS.name)) {
    const directors: Director[] = reg.directors.map((ind) => ({
      id: uuid(),
      entity: entityFromIndividual(uuid(), ind),
      shareholder: false,
      beneficialOwner: false,
      source: 'Companies House (stub)',
    }));
    await saveSection(tenant, { formId: form.id, name: SECTIONS.DIRECTORS.name, data: { directors }, updatedAt: nowIso() });
  }
}

async function formView(req: Request, form: OnboardingForm) {
  const actor = requireClientId(req.auth);
  const [sections, notes] = await Promise.all([getSections(req.auth.tenant, form.id), getNotes(req.auth.tenant, form.id)]);
  return {
    form,
    sections: form.requirements.map((r) => {
      const s = sections.find((x) => x.name === r.sectionName);
      return { requirement: r, data: s?.data ?? null, missing: missingFields(r.sectionName, s?.data), updatedAt: s?.updatedAt };
    }),
    notes,
    permissions: { canEdit: canEdit(form, actor), canReview: canReview(form, actor), isSelfOnboarding: actor === form.clientId },
  };
}

export const routes: Routes = {
  'POST /clients/{clientId}/onboarding': async (req) => {
    const actor = requireClientId(req.auth);
    const client = await getAccessibleClient(req.auth.tenant, req.params.clientId, actor);
    if (client.id === actor) throw forbidden('You cannot start your own onboarding');
    if (client.type !== 'COMPANY') throw badRequest('Only companies are onboarded');
    const existing = await latestFormForClient(req.auth.tenant, client.id);
    if (existing && !CLOSED.includes(existing.status) && existing.status !== 'APPROVED' && existing.status !== 'EXPIRING') {
      throw badRequest(`${client.name} already has an onboarding in progress`);
    }
    const onboardingType = req.body.onboardingType === 'NON_REGULATED' ? 'NON_REGULATED' : 'REGULATED';
    const inviteEmail = req.body.invite ? String(req.body.inviteEmail ?? '').trim().toLowerCase() : undefined;
    if (req.body.invite && !inviteEmail) throw badRequest('inviteEmail is required when inviting');
    const requirements = buildRequirements({ ...req.body, onboardingType }, uuid);
    if (!requirements.length) throw badRequest('Choose at least one section');
    const form: OnboardingForm = {
      id: uuid(),
      clientId: client.id,
      clientName: client.name,
      onboardingType,
      expiresMonths: Number(req.body.expiresMonths) || 12,
      inviteEmail,
      requirements,
      status: 'PENDING',
      allSectionsCompleted: false,
      checksToRun: 0,
      checksFinished: 0,
      createdAt: nowIso(),
      createdByClientId: actor,
    };
    await saveForm(req.auth.tenant, form);
    if (req.body.prefill !== false) await prefill(req.auth.tenant, form);
    // Status change is published even for the first status so the client record follows.
    const status: OnboardingStatus = inviteEmail ? 'WAITING_SIGNUP' : 'PENDING';
    await publish('OnboardingStatusChanged', { tenant: req.auth.tenant, formId: form.id, clientId: form.clientId, status });
    return saveForm(req.auth.tenant, { ...form, status });
  },

  'GET /clients/{clientId}/onboarding': async (req) => {
    const client = await getAccessibleClient(req.auth.tenant, req.params.clientId, requireClientId(req.auth));
    const form = await latestFormForClient(req.auth.tenant, client.id);
    return form ? formView({ ...req, params: { formId: form.id } }, form) : { form: null };
  },

  'GET /onboarding/forms': async (req) => {
    const actor = requireClientId(req.auth);
    const items = await db().query(table(), { index: 'GSI2', pk: key(req.auth.tenant, 'CREATOR', actor), forward: false });
    let forms = items.map((i) => {
      const { tenant: _t, ...f } = strip<any>(i);
      return f as OnboardingForm;
    });
    if (req.query.status) forms = forms.filter((f) => f.status === req.query.status);
    return forms;
  },

  'GET /onboarding/{formId}': async (req) => formView(req, await accessibleForm(req)),

  'PUT /onboarding/{formId}/sections/{sectionName}': async (req) => {
    const form = await accessibleForm(req);
    if (!canEdit(form, requireClientId(req.auth))) throw forbidden('This onboarding form cannot be edited now');
    const name = req.params.sectionName;
    if (!form.requirements.some((r) => r.sectionName === name)) throw badRequest(`Section ${name} is not part of this form`);
    const data = req.body.data ?? {};
    await saveSection(req.auth.tenant, { formId: form.id, name, data, updatedAt: nowIso() });

    if (name === SECTIONS.DIRECTORS.name && form.requirements.some((r) => r.sectionName === SECTIONS.SHAREHOLDERS.name)) {
      const sections = await getSections(req.auth.tenant, form.id);
      const current = sections.find((s) => s.name === SECTIONS.SHAREHOLDERS.name)?.data?.shareholders ?? [];
      const synced = syncDirectorShareholders(data.directors ?? [], current);
      await saveSection(req.auth.tenant, { formId: form.id, name: SECTIONS.SHAREHOLDERS.name, data: { shareholders: synced }, updatedAt: nowIso() });
    }
    const sections = await getSections(req.auth.tenant, form.id);
    const completed = allSectionsCompleted(form, sections);
    if (completed !== form.allSectionsCompleted) await saveForm(req.auth.tenant, { ...form, allSectionsCompleted: completed });
    return formView(req, { ...form, allSectionsCompleted: completed });
  },

  'POST /onboarding/{formId}/notes': async (req) => {
    const form = await accessibleForm(req);
    if (!String(req.body.comment ?? '').trim()) throw badRequest('comment is required');
    return addNote(req, form.id, String(req.body.comment).trim(), req.body.relevantSectionNames ?? []);
  },

  'POST /onboarding/{formId}/submit': async (req) => {
    const form = await accessibleForm(req);
    if (!canEdit(form, requireClientId(req.auth))) throw forbidden('This onboarding form cannot be submitted now');
    const sections = await getSections(req.auth.tenant, form.id);
    if (!allSectionsCompleted(form, sections)) throw badRequest('Complete all sections before submitting');
    const checks = plannedChecks(form, sections);
    const status = statusAfterSubmit(form, checks.length);
    const updated = await setStatus(req.auth.tenant, form, status, {
      submittedAt: nowIso(),
      checksToRun: checks.length,
      checksFinished: 0,
      allSectionsCompleted: true,
    });
    if (checks.length) await publish('OnboardingSubmitted', { tenant: req.auth.tenant, formId: form.id, clientId: form.clientId, checks });
    return updated;
  },

  'POST /onboarding/{formId}/review': async (req) => {
    const form = await accessibleForm(req);
    if (!canReview(form, requireClientId(req.auth))) throw forbidden('This onboarding form cannot be reviewed now');
    const result = req.body.result as ReviewResult;
    if (!['APPROVE', 'REQUEST_CHANGES', 'REJECT'].includes(result)) throw badRequest('result must be APPROVE, REQUEST_CHANGES or REJECT');
    if (req.body.note?.trim()) await addNote(req, form.id, req.body.note.trim(), req.body.relevantSectionNames ?? []);
    return setStatus(req.auth.tenant, form, statusAfterReview(result));
  },
};

export async function onEvent(name: string, detail: any) {
  if (name === 'ChecksCompleted') {
    const form = await getForm(detail.tenant, detail.formId);
    if (!form || form.status !== 'CHECKS_IN_PROGRESS') return;
    await setStatus(detail.tenant, form, statusAfterChecks(form, detail), { checksFinished: detail.total });
  } else if (name === 'UserActivated') {
    const form = await latestFormForClient(detail.tenant, detail.clientId);
    if (form?.status === 'WAITING_SIGNUP') await setStatus(detail.tenant, form, 'PENDING');
  } else if (name === 'Scheduled Event') {
    await scanExpiry();
  }
}

/** Daily: approved forms move to EXPIRING within 30 days of their expiry and to EXPIRED after it. */
export async function scanExpiry(now = nowIso()) {
  const items = await db().query<any>(table(), { index: 'GSI3', pk: 'ALLFORMS' });
  let changed = 0;
  for (const item of items) {
    const { tenant, ...rest } = strip<any>(item);
    const form = rest as OnboardingForm;
    const next = expiryStatus(form, now);
    if (next) {
      await setStatus(tenant, form, next);
      changed++;
    }
  }
  return changed;
}

export const handler = async (event: any) => {
  if (isHttpEvent(event)) return dispatch(routes, event);
  if (isEventBridgeEvent(event)) return onEvent(event['detail-type'], event.detail);
  throw new Error('Unsupported event');
};
