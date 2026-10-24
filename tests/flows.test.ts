import { beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../services/seed/handler';
import { TENANT, auth, call, expectHttpError, setup } from './helpers';

let rootId: string;
let ctx: ReturnType<typeof setup>;

beforeEach(async () => {
  ctx = setup();
  const res = await seed({ tenant: TENANT, createUsers: false });
  rootId = res.rootClientId;
});

const root = () => auth(rootId);

async function pspByName(name: string) {
  const psps = await call('GET /psps', root(), { query: { size: '50' } });
  return psps.items.find((p: any) => p.name === name);
}

describe('demo data', () => {
  it('creates the account, seven PSPs, customers and transactions, some on hold', async () => {
    const psps = await call('GET /psps', root());
    expect(psps.items.map((p: any) => [p.name, p.onboardingStatus])).toEqual([
      ['Bluepeak Money Ltd', 'IN_REVIEW'],
      ['ClickCash Ltd', 'APPROVED'],
      ['CreditBond Ltd', 'CHECKS_FAILED'],
      ['DigiCash Services Ltd', 'EXPIRED'],
      ['Northwind Remit Ltd', 'NOT_STARTED'],
      ['PayMate Payments Ltd', 'APPROVED'],
      ['Walletly Ltd', 'APPROVED'],
    ]);
    const customers = await call('GET /customers', root(), { query: { size: '100' } });
    expect(customers.total).toBe(9);
    const dash = await call('GET /dashboard', root());
    expect(dash.onHold.count).toBeGreaterThan(0);
    const all = await call('GET /transactions', root(), { query: { size: '200' } });
    expect(all.total).toBe(50);
    const reasons = new Set(all.items.flatMap((t: any) => t.risks.map((r: any) => r.type)));
    expect([...reasons]).toEqual(expect.arrayContaining(['CORRESPONDENT', 'MISSING_DOCUMENTS', 'BANK_JURISDICTION']));
  });

  it('is idempotent unless reset', async () => {
    const again = await seed({ tenant: TENANT, createUsers: false });
    expect(again.status).toBe('already-seeded');
    const reset = await seed({ tenant: TENANT, createUsers: false, reset: true });
    expect(reset.status).toBe('seeded');
    expect(reset.rootClientId).not.toBe(rootId);
  });
});

describe('hierarchy access', () => {
  it('lets a PSP see its own customers but not another PSP', async () => {
    const click = await pspByName('ClickCash Ltd');
    const pay = await pspByName('PayMate Payments Ltd');
    const asClick = auth(click.id);
    const own = await call('GET /customers', asClick);
    expect(own.total).toBe(3);
    await expectHttpError(call('GET /clients/{clientId}', asClick, { params: { clientId: pay.id } }), 403);
    const txs = await call('GET /transactions', asClick, { query: { size: '200' } });
    expect(txs.items.every((t: any) => t.pspClientId === click.id)).toBe(true);
  });
});

describe('onboarding a new PSP', () => {
  it('runs from start to approval with prefilled company data and stubbed checks', async () => {
    const psp = await pspByName('Northwind Remit Ltd');
    const form = await call('POST /clients/{clientId}/onboarding', root(), {
      params: { clientId: psp.id },
      body: { onboardingType: 'NON_REGULATED', expiresMonths: 12 },
    });
    expect(form.status).toBe('PENDING');

    let view = await call('GET /onboarding/{formId}', root(), { params: { formId: form.id } });
    const section = (name: string) => view.sections.find((s: any) => s.requirement.sectionName === name);
    expect(section('company-information').missing).toEqual([]);
    const directors = section('directors').data.directors;
    expect(directors).toHaveLength(2);

    const put = (name: string, data: any) =>
      call('PUT /onboarding/{formId}/sections/{sectionName}', root(), { params: { formId: form.id, sectionName: name }, body: { data } });
    const person = { firstName: 'Jack', lastName: 'Turner', dateOfBirth: '1988-04-11', email: 'jack@example.com', address: { addressLine1: '1 Road', city: 'Leeds', postCode: 'LS1', countryCode: 'GB' } };
    await put('primary-contact', { individual: person });
    view = await put('directors', { directors: directors.map((d: any, i: number) => ({ ...d, shareholder: i === 0 })) });
    expect(section('shareholders').data.shareholders).toHaveLength(1);
    view = await put('banking-details', { accountName: 'Northwind', accountNumber: '12345678', sortCode: '00-11-22' });
    expect(view.form.allSectionsCompleted).toBe(true);

    const submitted = await call('POST /onboarding/{formId}/submit', root(), { params: { formId: form.id } });
    expect(submitted.status).toBe('CHECKS_IN_PROGRESS');

    view = await call('GET /onboarding/{formId}', root(), { params: { formId: form.id } });
    expect(view.form.status).toBe('APPROVED');
    const checks = await call('GET /onboarding/{formId}/checks', root(), { params: { formId: form.id } });
    expect(checks).toHaveLength(5); // company, contact, 2 directors, 1 shareholder
    expect(checks.every((c: any) => c.status === 'PASSED')).toBe(true);
    const client = await call('GET /clients/{clientId}', root(), { params: { clientId: psp.id } });
    expect(client.client.onboardingStatus).toBe('APPROVED');
  });

  it('sends invited forms with failed checks back for review', async () => {
    const created = await call('POST /psps', root(), { body: { registrationNumber: '20684937' } }); // Failsafe Remittance
    const form = await call('POST /clients/{clientId}/onboarding', root(), {
      params: { clientId: created.id },
      body: { onboardingType: 'NON_REGULATED', sectionNames: ['company-information', 'directors'], invite: true, inviteEmail: 'ops@failsafe.example' },
    });
    expect(form.status).toBe('WAITING_SIGNUP');
    // The parent cannot fill an invited form
    await expectHttpError(call('PUT /onboarding/{formId}/sections/{sectionName}', root(), { params: { formId: form.id, sectionName: 'directors' }, body: { data: {} } }), 403);

    const asPsp = auth(created.id);
    await call('GET /me', asPsp);
    let view = await call('GET /onboarding/{formId}', asPsp, { params: { formId: form.id } });
    expect(view.form.status).toBe('PENDING');
    expect(view.permissions.canEdit).toBe(true);

    const submitted = await call('POST /onboarding/{formId}/submit', asPsp, { params: { formId: form.id } });
    expect(submitted.status).toBe('CHECKS_IN_PROGRESS');
    view = await call('GET /onboarding/{formId}', root(), { params: { formId: form.id } });
    expect(view.form.status).toBe('CHECKS_FAILED'); // director "Leo Fail" fails AML
    expect(view.permissions.canReview).toBe(true);

    await call('POST /onboarding/{formId}/review', root(), { params: { formId: form.id }, body: { result: 'REQUEST_CHANGES', note: 'Please replace the director' } });
    view = await call('GET /onboarding/{formId}', asPsp, { params: { formId: form.id } });
    expect(view.form.status).toBe('CHANGES_REQUESTED');
    expect(view.notes[0].comment).toBe('Please replace the director');
  });
});

describe('transactions', () => {
  it('releases a held transaction when documents are uploaded', async () => {
    const held = await call('GET /transactions', root(), { query: { status: 'ON_HOLD', size: '200' } });
    const docsOnly = held.items.find((t: any) => t.risks.length === 1 && t.risks[0].type === 'MISSING_DOCUMENTS');
    expect(docsOnly).toBeDefined();
    const updated = await call('POST /transactions/{transactionId}/documents', root(), {
      params: { transactionId: docsOnly.id },
      body: { type: 'Invoice', files: [{ key: `t/${TENANT}/x/invoice.pdf`, name: 'invoice.pdf' }] },
    });
    expect(updated.status).toBe('APPROVED');
  });

  it('re-checks a customer when limits change', async () => {
    const held = await call('GET /transactions', root(), { query: { status: 'ON_HOLD', size: '200' } });
    const jurisdiction = held.items.find((t: any) => t.risks.length === 1 && t.risks[0].type === 'BANK_JURISDICTION' && t.type === 'INCOMING');
    expect(jurisdiction).toBeDefined();
    const { client } = await call('GET /clients/{clientId}', root(), { params: { clientId: jurisdiction.clientId } });
    await call('PUT /clients/{clientId}/tx-settings/{direction}', root(), {
      params: { clientId: client.id, direction: 'incoming' },
      body: { settings: { ...client.incomingTxSettings, jurisdictions: [...client.incomingTxSettings.jurisdictions, 'PT'] } },
    });
    const after = await call('GET /transactions/{transactionId}', root(), { params: { transactionId: jurisdiction.id } });
    expect(after.transaction.status).toBe('APPROVED');
  });

  it('holds every transaction of a PSP whose onboarding is no longer approved', async () => {
    const click = await pspByName('ClickCash Ltd');
    const { published } = ctx;
    published.length = 0;
    const { publish } = await import('../services/shared/events');
    await publish('OnboardingStatusChanged', { tenant: TENANT, formId: 'f', clientId: click.id, status: 'EXPIRED' });
    const txs = await call('GET /transactions', root(), { query: { pspId: click.id, size: '200' } });
    expect(txs.items.every((t: any) => t.risks.some((r: any) => r.type === 'PSP'))).toBe(true);
  });

  it('simulates a transaction for a customer', async () => {
    const customers = await call('GET /customers', root());
    const tx = await call('POST /transactions/simulate', root(), { body: { clientId: customers.items[0].id, type: 'INCOMING', amount: 100_00 } });
    expect(tx.receivedAmount).toBe(100_00);
    expect(['APPROVED', 'ON_HOLD']).toContain(tx.status);
  });
});
