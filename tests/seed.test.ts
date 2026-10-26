import { beforeEach, describe, expect, it } from 'vitest';
import { setup, auth, call, TENANT } from './helpers';
import { seed } from '../services/seed/handler';

describe('seed', () => {
  beforeEach(() => setup());

  it('takes each PSP to its demo onboarding status through the real flow', async () => {
    const result = await seed({ tenant: TENANT, createUsers: false });
    expect(result.status).toBe('seeded');
    const root = auth(result.rootClientId);
    const psps = await call('GET /psps', root, { query: { size: '50' } });
    const status = Object.fromEntries(psps.items.map((p: any) => [p.name, p.onboardingStatus]));
    expect(status).toEqual({
      'Bluepeak Money Ltd': 'IN_REVIEW',
      'ClickCash Ltd': 'APPROVED',
      'CreditBond Ltd': 'CHECKS_FAILED',
      'DigiCash Services Ltd': 'EXPIRED',
      'Northwind Remit Ltd': 'NOT_STARTED',
      'PayMate Payments Ltd': 'APPROVED',
      'Walletly Ltd': 'APPROVED',
    });
    const forms = await call('GET /onboarding/forms', root);
    expect(forms).toHaveLength(6);
    const failed = forms.find((f: any) => f.clientName === 'CreditBond Ltd');
    const checks = await call('GET /onboarding/{formId}/checks', root, { params: { formId: failed.id } });
    expect(checks.some((c: any) => c.status === 'FAILED')).toBe(true);
    expect(result.transactions).toBe(50);
  });

});
