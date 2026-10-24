import {
  CHECK_LEVELS,
  ChecksLevel,
  Entity,
  EntityType,
  OnboardingForm,
  OnboardingSection,
  OnboardingStatus,
  OnboardingType,
  SectionRequirement,
  entityFromCompany,
  entityFromIndividual,
} from '../shared/types';
import { addMonths, daysBetween } from '../shared/util';

export interface SectionDefinition {
  name: string;
  label: string;
  /** Entity types this section produces for checks; empty = section has no checks. */
  checkedEntityTypes: EntityType[];
  defaultCheckLevels: ChecksLevel[];
}

export const SECTIONS = {
  COMPANY_INFO: {
    name: 'company-information',
    label: 'Company information',
    checkedEntityTypes: ['COMPANY'],
    defaultCheckLevels: ['COMPANY_STANDARD'],
  },
  PRIMARY_CONTACT: {
    name: 'primary-contact',
    label: 'Primary contact',
    checkedEntityTypes: ['INDIVIDUAL'],
    defaultCheckLevels: ['INDIVIDUAL_STANDARD'],
  },
  MLRO: {
    name: 'mlro',
    label: 'Money Laundering Reporting Officer',
    checkedEntityTypes: ['INDIVIDUAL'],
    defaultCheckLevels: ['INDIVIDUAL_ENHANCED'],
  },
  DIRECTORS: {
    name: 'directors',
    label: 'Directors',
    checkedEntityTypes: ['INDIVIDUAL', 'COMPANY'],
    defaultCheckLevels: ['INDIVIDUAL_STANDARD', 'COMPANY_BASIC'],
  },
  SHAREHOLDERS: {
    name: 'shareholders',
    label: 'Shareholders',
    checkedEntityTypes: ['INDIVIDUAL', 'COMPANY'],
    defaultCheckLevels: ['INDIVIDUAL_BASIC', 'COMPANY_BASIC'],
  },
  LICENSING_INFO: {
    name: 'licensing-information',
    label: 'Licensing information',
    checkedEntityTypes: [],
    defaultCheckLevels: [],
  },
  INDEPENDENT_AUDIT: { name: 'independent-audit', label: 'Independent audit', checkedEntityTypes: [], defaultCheckLevels: [] },
  BANKING_DETAILS: { name: 'banking-details', label: 'Banking details', checkedEntityTypes: [], defaultCheckLevels: [] },
} as const satisfies Record<string, SectionDefinition>;

export const ALL_SECTIONS: SectionDefinition[] = Object.values(SECTIONS);
export const CUSTOM_PREFIX = 'custom-section-';

export const ONBOARDING_DEFINITIONS: Record<OnboardingType, string[]> = {
  REGULATED: [
    SECTIONS.COMPANY_INFO.name,
    SECTIONS.PRIMARY_CONTACT.name,
    SECTIONS.MLRO.name,
    SECTIONS.DIRECTORS.name,
    SECTIONS.SHAREHOLDERS.name,
    SECTIONS.LICENSING_INFO.name,
    SECTIONS.INDEPENDENT_AUDIT.name,
    SECTIONS.BANKING_DETAILS.name,
  ],
  NON_REGULATED: [
    SECTIONS.COMPANY_INFO.name,
    SECTIONS.PRIMARY_CONTACT.name,
    SECTIONS.DIRECTORS.name,
    SECTIONS.SHAREHOLDERS.name,
    SECTIONS.BANKING_DETAILS.name,
  ],
};

export function sectionDefinition(name: string): SectionDefinition | undefined {
  return ALL_SECTIONS.find((s) => s.name === name);
}

export const isCustomSection = (name: string) => name.startsWith(CUSTOM_PREFIX);

export interface StartOnboardingInput {
  onboardingType: OnboardingType;
  /** Section names to include; defaults to the onboarding type's definition. */
  sectionNames?: string[];
  /** Check levels per section name; defaults to each section's defaults. */
  sectionChecks?: Record<string, ChecksLevel[]>;
  /** Display names of extra custom sections (document upload + comment). */
  customSections?: string[];
}

export function buildRequirements(input: StartOnboardingInput, newId: () => string): SectionRequirement[] {
  const names = input.sectionNames?.length ? input.sectionNames : ONBOARDING_DEFINITIONS[input.onboardingType];
  const reqs: SectionRequirement[] = [];
  for (const def of ALL_SECTIONS) {
    if (!names.includes(def.name)) continue;
    const requested = input.sectionChecks?.[def.name];
    const levels = (requested ?? def.defaultCheckLevels).filter((l) =>
      def.checkedEntityTypes.includes(CHECK_LEVELS[l]?.entityType as EntityType),
    );
    reqs.push({ sectionName: def.name, sectionLabel: def.label, checkLevels: levels, isCustom: false });
  }
  for (const label of input.customSections ?? []) {
    if (!label.trim()) continue;
    reqs.push({ sectionName: CUSTOM_PREFIX + newId(), sectionLabel: label.trim(), checkLevels: [], isCustom: true });
  }
  return reqs;
}

/** The entities a section asks to be checked, with stable ids. */
export function entitiesToCheck(section: Pick<OnboardingSection, 'name' | 'data'>): Entity[] {
  const d = section.data ?? {};
  switch (section.name) {
    case SECTIONS.COMPANY_INFO.name:
      return d.company ? [entityFromCompany('company', d.company)] : [];
    case SECTIONS.PRIMARY_CONTACT.name:
      return d.individual ? [entityFromIndividual('primary-contact', d.individual)] : [];
    case SECTIONS.MLRO.name:
      return d.individual ? [entityFromIndividual('mlro', d.individual)] : [];
    case SECTIONS.DIRECTORS.name:
      return (d.directors ?? []).map((x: any) => x.entity);
    case SECTIONS.SHAREHOLDERS.name:
      return (d.shareholders ?? []).map((x: any) => x.entity);
    default:
      return [];
  }
}

const filled = (v: any) => v !== undefined && v !== null && !(typeof v === 'string' && !v.trim());
const filesPresent = (v: any) => Array.isArray(v) && v.length > 0;

function missingAddress(prefix: string, a: any): string[] {
  if (!a) return [prefix];
  return ['addressLine1', 'city', 'postCode', 'countryCode'].filter((f) => !filled(a[f])).map((f) => `${prefix}.${f}`);
}

function missingIndividual(prefix: string, i: any): string[] {
  if (!i) return [prefix];
  return [
    ...['firstName', 'lastName', 'dateOfBirth', 'email'].filter((f) => !filled(i[f])).map((f) => `${prefix}.${f}`),
    ...missingAddress(`${prefix}.address`, i.address),
  ];
}

/** Lists the fields a section still needs. An empty list means the section is complete. */
export function missingFields(sectionName: string, data: Record<string, any> | undefined): string[] {
  const d = data ?? {};
  switch (sectionName) {
    case SECTIONS.COMPANY_INFO.name: {
      const c = d.company;
      if (!c) return ['company'];
      return [
        ...['name', 'jurisdiction', 'registrationNumber'].filter((f) => !filled(c[f])).map((f) => `company.${f}`),
        ...missingAddress('company.registeredAddress', c.registeredAddress),
      ];
    }
    case SECTIONS.PRIMARY_CONTACT.name:
    case SECTIONS.MLRO.name:
      return missingIndividual('individual', d.individual);
    case SECTIONS.DIRECTORS.name:
      return (d.directors ?? []).length ? [] : ['directors'];
    case SECTIONS.SHAREHOLDERS.name:
      return (d.shareholders ?? []).length ? [] : ['shareholders'];
    case SECTIONS.LICENSING_INFO.name:
      return [
        ...(filled(d.regulator) ? [] : ['regulator']),
        ...(filled(d.licenseNumber) ? [] : ['licenseNumber']),
        ...(filesPresent(d.licensingDocuments) ? [] : ['licensingDocuments']),
      ];
    case SECTIONS.INDEPENDENT_AUDIT.name:
      return [
        ...(filled(d.conductedBy) ? [] : ['conductedBy']),
        ...(filled(d.auditDate) ? [] : ['auditDate']),
        ...(filesPresent(d.auditFiles) ? [] : ['auditFiles']),
      ];
    case SECTIONS.BANKING_DETAILS.name:
      return ['accountName', 'accountNumber', 'sortCode'].filter((f) => !filled(d[f]));
    default:
      if (isCustomSection(sectionName)) return filesPresent(d.files) || filled(d.comment) ? [] : ['files'];
      return [];
  }
}

export function allSectionsCompleted(form: OnboardingForm, sections: OnboardingSection[]): boolean {
  return form.requirements.every((r) => {
    const s = sections.find((x) => x.name === r.sectionName);
    return !!s && missingFields(r.sectionName, s.data).length === 0;
  });
}

export interface PlannedCheck {
  sectionName: string;
  entity: Entity;
  level: ChecksLevel;
}

/** One check per entity in each section that requires checks, at the level configured for its entity type. */
export function plannedChecks(form: OnboardingForm, sections: OnboardingSection[]): PlannedCheck[] {
  const out: PlannedCheck[] = [];
  for (const req of form.requirements) {
    if (!req.checkLevels.length) continue;
    const section = sections.find((s) => s.name === req.sectionName);
    if (!section) continue;
    for (const entity of entitiesToCheck(section)) {
      const level = req.checkLevels.find((l) => CHECK_LEVELS[l].entityType === entity.type);
      if (level) out.push({ sectionName: req.sectionName, entity, level });
    }
  }
  return out;
}

export const EDITABLE_STATUSES: OnboardingStatus[] = ['NOT_STARTED', 'PENDING', 'CHANGES_REQUESTED', 'CHECKS_FAILED'];
export const REVIEWABLE_STATUSES: OnboardingStatus[] = ['IN_REVIEW', 'CHECKS_FAILED'];

/**
 * Invited forms are filled by the invited client; otherwise by the client that created the form.
 * Either way only while the status allows edits.
 */
export function canEdit(form: OnboardingForm, actingClientId: string): boolean {
  const filler = form.inviteEmail ? form.clientId : form.createdByClientId;
  return actingClientId === filler && EDITABLE_STATUSES.includes(form.status);
}

export function canReview(form: OnboardingForm, actingClientId: string): boolean {
  return actingClientId === form.createdByClientId && REVIEWABLE_STATUSES.includes(form.status);
}

export function statusAfterSubmit(form: OnboardingForm, checkCount: number): OnboardingStatus {
  if (checkCount > 0) return 'CHECKS_IN_PROGRESS';
  return form.inviteEmail ? 'IN_REVIEW' : 'APPROVED';
}

export function statusAfterChecks(form: OnboardingForm, result: { failed: number; errors: number }): OnboardingStatus {
  if (result.failed > 0 || result.errors > 0) return 'CHECKS_FAILED';
  return form.inviteEmail ? 'IN_REVIEW' : 'APPROVED';
}

export type ReviewResult = 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';

export function statusAfterReview(result: ReviewResult): OnboardingStatus {
  return result === 'APPROVE' ? 'APPROVED' : result === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : 'REJECTED';
}

export const EXPIRING_WITHIN_DAYS = 30;

/** For approved forms: EXPIRED after approvedAt + expiresMonths, EXPIRING within 30 days of it, else unchanged. */
export function expiryStatus(form: OnboardingForm, nowIso: string): OnboardingStatus | undefined {
  if (!['APPROVED', 'EXPIRING'].includes(form.status) || !form.approvedAt) return undefined;
  const expiresAt = addMonths(form.approvedAt, form.expiresMonths);
  const days = daysBetween(nowIso, expiresAt);
  if (days < 0) return 'EXPIRED';
  if (days <= EXPIRING_WITHIN_DAYS) return form.status === 'EXPIRING' ? undefined : 'EXPIRING';
  return undefined;
}
