import { describe, expect, it } from 'vitest';
import { buildRequirements, canEdit, expiryStatus, missingFields, plannedChecks } from '../services/domain/onboarding';
import type { OnboardingForm } from '../services/shared/types';

let n = 0;
const id = () => `id${++n}`;

const form = (over: Partial<OnboardingForm> = {}): OnboardingForm => ({
  id: 'f1', clientId: 'psp', clientName: 'PSP', onboardingType: 'REGULATED', expiresMonths: 12,
  requirements: buildRequirements({ onboardingType: 'REGULATED' }, id), status: 'PENDING', allSectionsCompleted: false,
  checksToRun: 0, checksFinished: 0, createdAt: '2026-01-01T00:00:00Z', createdByClientId: 'root', ...over,
});

describe('onboarding rules', () => {
  it('builds the eight regulated sections plus custom ones', () => {
    const reqs = buildRequirements({ onboardingType: 'REGULATED', customSections: ['AML policy'] }, id);
    expect(reqs.map((r) => r.sectionName).slice(0, 8)).toEqual([
      'company-information', 'primary-contact', 'mlro', 'directors', 'shareholders',
      'licensing-information', 'independent-audit', 'banking-details',
    ]);
    expect(reqs[8]).toMatchObject({ sectionLabel: 'AML policy', isCustom: true, checkLevels: [] });
  });

  it('drops check levels that do not match the section entity type', () => {
    const [r] = buildRequirements({ onboardingType: 'NON_REGULATED', sectionNames: ['company-information'], sectionChecks: { 'company-information': ['INDIVIDUAL_BASIC', 'COMPANY_BASIC'] } }, id);
    expect(r.checkLevels).toEqual(['COMPANY_BASIC']);
  });

  it('lists missing fields', () => {
    expect(missingFields('banking-details', { accountName: 'X' })).toEqual(['accountNumber', 'sortCode']);
    expect(missingFields('directors', { directors: [] })).toEqual(['directors']);
  });

  it('plans one check per entity at the level for its type', () => {
    const f = form();
    const checks = plannedChecks(f, [
      { formId: 'f1', name: 'directors', updatedAt: '', data: { directors: [
        { id: 'd1', entity: { id: 'e1', type: 'INDIVIDUAL', name: 'A B' } },
        { id: 'd2', entity: { id: 'e2', type: 'COMPANY', name: 'Holdco' } },
      ] } },
    ]);
    expect(checks.map((c) => [c.entity.id, c.level])).toEqual([['e1', 'INDIVIDUAL_STANDARD'], ['e2', 'COMPANY_BASIC']]);
  });

  it('lets only the invited client edit an invite form', () => {
    expect(canEdit(form({ inviteEmail: 'x@y.z' }), 'psp')).toBe(true);
    expect(canEdit(form({ inviteEmail: 'x@y.z' }), 'root')).toBe(false);
    expect(canEdit(form(), 'root')).toBe(true);
    expect(canEdit(form({ status: 'IN_REVIEW' }), 'root')).toBe(false);
  });

  it('moves approved forms to expiring and expired', () => {
    const f = form({ status: 'APPROVED', approvedAt: '2025-11-01T00:00:00Z' });
    expect(expiryStatus(f, '2026-06-01T00:00:00Z')).toBeUndefined();
    expect(expiryStatus(f, '2026-10-20T00:00:00Z')).toBe('EXPIRING');
    expect(expiryStatus(f, '2026-11-02T00:00:00Z')).toBe('EXPIRED');
  });
});
