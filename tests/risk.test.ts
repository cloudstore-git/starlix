import { describe, expect, it } from 'vitest';
import { evaluateRisks, monthlyStatsFor } from '../services/domain/risk';
import { Client, DEFAULT_TX_SETTINGS, Transaction } from '../services/shared/types';

const client = (over: Partial<Client> = {}): Client => ({
  id: 'c1',
  kind: 'CUSTOMER',
  type: 'INDIVIDUAL',
  name: 'Ashlyn Heathcote',
  chain: ['root', 'psp'],
  parentClientId: 'psp',
  rootClientId: 'root',
  onboardingStatus: 'APPROVED',
  incomingTxSettings: { ...DEFAULT_TX_SETTINGS, jurisdictions: ['FR', 'GB'] },
  outgoingTxSettings: { ...DEFAULT_TX_SETTINGS, jurisdictions: ['GB', 'IT'] },
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});
const psp = client({ id: 'psp', kind: 'PSP', type: 'COMPANY', name: 'ClickCash', chain: ['root'] });

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 't1',
  type: 'OUTGOING',
  sentAmount: 1000_00,
  receivedAmount: 1160_00,
  sentCurrency: 'GBP',
  receivedCurrency: 'EUR',
  fxRate: 0.86,
  clientId: 'c1',
  pspClientId: 'psp',
  rootClientId: 'root',
  chain: ['root', 'psp'],
  risks: [],
  status: 'APPROVED',
  supportingDocuments: [],
  timestamp: '2026-10-10T10:00:00Z',
  beneficiaryBank: { name: 'UniCredit', jurisdiction: 'IT', registrationNumber: 'x' },
  ...over,
});

const types = (t: Transaction, extra: any = {}) =>
  evaluateRisks({ tx: t, customer: client(), psp, monthly: { count: 0, total: 0 }, today: '2026-10-24', ...extra }).map((r) => r.type);

describe('risk rules', () => {
  it('approves a small transaction within limits', () => {
    expect(types(tx())).toEqual([]);
  });

  it('flags amounts over the maximum, and missing documents over the threshold', () => {
    expect(types(tx({ sentAmount: 12_000_00 }))).toEqual(['AMOUNT', 'MISSING_DOCUMENTS']);
  });

  it('clears the documents risk once documents are attached', () => {
    const t = tx({ sentAmount: 6_000_00, supportingDocuments: [{ type: 'Invoice', files: [{ key: 'k', name: 'inv.pdf' }] }] });
    expect(types(t)).toEqual([]);
  });

  it('flags a PSP that is not approved', () => {
    expect(types(tx(), { psp: { ...psp, onboardingStatus: 'EXPIRED' } })).toEqual(['PSP']);
  });

  it('flags an expired correspondent licence', () => {
    const correspondent = {
      id: 'k', type: 'PARTNER', name: 'Cash Nigeria', clientId: 'psp', rootClientId: 'root', onboardingStatus: 'APPROVED',
      licenseExpires: '2026-10-01', licenseDocuments: [], company: { name: 'Cash Nigeria', jurisdiction: 'IT', registrationNumber: '1' },
    } as const;
    expect(types(tx({ beneficiaryBank: undefined, correspondentId: 'k' }), { correspondent })).toEqual(['CORRESPONDENT']);
  });

  it('flags counterparty banks outside the allowed jurisdictions', () => {
    const incoming = tx({ type: 'INCOMING', sentCurrency: 'EUR', receivedCurrency: 'GBP', receivedAmount: 900_00, senderBank: { name: 'Novobanco', jurisdiction: 'PT', registrationNumber: 'x' } });
    const risks = evaluateRisks({ tx: incoming, customer: client(), psp, monthly: { count: 0, total: 0 } });
    expect(risks.map((r) => [r.type, r.target])).toEqual([['BANK_JURISDICTION', 'SENDER']]);
  });

  it('flags the transaction that breaks the monthly count', () => {
    expect(types(tx(), { monthly: { count: 10, total: 0 } })).toEqual(['MONTHLY_LIMIT']);
    expect(types(tx(), { monthly: { count: 1, total: 99_500_00 } })).toEqual(['MONTHLY_LIMIT']);
  });

  it('computes monthly stats from earlier transactions of the same client, type and month', () => {
    const stats = monthlyStatsFor([
      tx({ id: 'a', timestamp: '2026-10-02T00:00:00Z' }),
      tx({ id: 'b', timestamp: '2026-10-05T00:00:00Z', sentAmount: 2000_00 }),
      tx({ id: 'c', timestamp: '2026-09-30T00:00:00Z' }),
      tx({ id: 'd', timestamp: '2026-10-06T00:00:00Z', type: 'INCOMING', sentCurrency: 'EUR', receivedCurrency: 'GBP' }),
      tx({ id: 'e', timestamp: '2026-10-07T00:00:00Z' }),
    ]);
    expect(stats.get('a')).toEqual({ count: 0, total: 0 });
    expect(stats.get('e')).toEqual({ count: 2, total: 3000_00 });
    expect(stats.get('d')).toEqual({ count: 0, total: 0 });
  });
});
