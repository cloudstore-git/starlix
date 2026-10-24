import type { Client, Correspondent, Transaction, TransactionRisk, TxSettings } from '../shared/types';
import { formatMoney, today } from '../shared/util';

export interface MonthlyStats {
  /** Transactions of the same client and type earlier in the same calendar month. */
  count: number;
  total: number;
}

export interface RiskContext {
  tx: Transaction;
  customer: Client;
  psp: Client;
  correspondent?: Correspondent;
  monthly: MonthlyStats;
  /** YYYY-MM-DD, injectable for tests */
  today?: string;
}

export interface RiskRule {
  name: string;
  check(ctx: RiskContext): TransactionRisk | undefined;
}

/** Amounts are compared in GBP, the platform currency: whichever leg is in GBP, else the sent amount. */
export function gbpAmount(tx: Transaction): number {
  if (tx.sentCurrency === 'GBP') return tx.sentAmount;
  if (tx.receivedCurrency === 'GBP') return tx.receivedAmount;
  return tx.sentAmount;
}

export function settingsFor(client: Client, tx: Transaction): TxSettings {
  return tx.type === 'INCOMING' ? client.incomingTxSettings : client.outgoingTxSettings;
}

const direction = (tx: Transaction) => (tx.type === 'INCOMING' ? 'incoming' : 'outgoing');

export const maxAmountRule: RiskRule = {
  name: 'Maximum transaction amount',
  check({ tx, customer }) {
    const max = settingsFor(customer, tx).maxTransactionAmount;
    const amount = gbpAmount(tx);
    if (amount <= max) return undefined;
    return {
      type: 'AMOUNT',
      ruleName: this.name,
      target: 'CUSTOMER',
      message: `${formatMoney(amount)} is greater than the maximum ${direction(tx)} amount of ${formatMoney(max)} for ${customer.name}`,
    };
  },
};

export const monthlyLimitRule: RiskRule = {
  name: 'Monthly limits',
  check({ tx, customer, monthly }) {
    const s = settingsFor(customer, tx);
    const count = monthly.count + 1;
    const total = monthly.total + gbpAmount(tx);
    if (count > s.transactionsPerMonth) {
      return {
        type: 'MONTHLY_LIMIT',
        ruleName: this.name,
        target: 'CUSTOMER',
        message: `This is ${customer.name}'s ${count}th ${direction(tx)} transaction this month; the limit is ${s.transactionsPerMonth}`,
      };
    }
    if (total > s.transactionTotalPerMonth) {
      return {
        type: 'MONTHLY_LIMIT',
        ruleName: this.name,
        target: 'CUSTOMER',
        message: `${customer.name}'s ${direction(tx)} total this month would reach ${formatMoney(total)}, over the monthly limit of ${formatMoney(s.transactionTotalPerMonth)}`,
      };
    }
    return undefined;
  },
};

export const supportingDocsRule: RiskRule = {
  name: 'Missing supporting documents',
  check({ tx, customer }) {
    const threshold = settingsFor(customer, tx).requireDocsWhenGreaterThan;
    const hasDocs = tx.supportingDocuments.some((d) => d.files.length > 0);
    if (gbpAmount(tx) <= threshold || hasDocs) return undefined;
    return {
      type: 'MISSING_DOCUMENTS',
      ruleName: this.name,
      target: 'TRANSACTION',
      message: `Supporting documents are required for transactions over ${formatMoney(threshold)}`,
    };
  },
};

export const pspOnboardingRule: RiskRule = {
  name: 'PSP onboarding',
  check({ psp }) {
    if (psp.onboardingStatus === 'APPROVED' || psp.onboardingStatus === 'EXPIRING') return undefined;
    return {
      type: 'PSP',
      ruleName: this.name,
      target: 'PSP',
      message: `${psp.name}, the PSP processing this transaction, has onboarding status ${psp.onboardingStatus.replace(/_/g, ' ').toLowerCase()}`,
    };
  },
};

export const correspondentLicenseRule: RiskRule = {
  name: 'Correspondent licence',
  check({ tx, correspondent, today: t }) {
    if (tx.type !== 'OUTGOING' || !correspondent) return undefined;
    if (correspondent.licenseExpires >= (t ?? today())) return undefined;
    return {
      type: 'CORRESPONDENT',
      ruleName: this.name,
      target: 'CORRESPONDENT',
      message: `Licence expired on ${correspondent.licenseExpires} for correspondent ${correspondent.name}`,
    };
  },
};

/** Country of the counterparty's bank: sender bank for incoming; beneficiary bank, correspondent or beneficiary for outgoing. */
export function counterpartyCountry(tx: Transaction, correspondent?: Correspondent): string | undefined {
  if (tx.type === 'INCOMING') return tx.senderBank?.jurisdiction;
  return (
    tx.beneficiaryBank?.jurisdiction ??
    correspondent?.company.jurisdiction ??
    tx.beneficiary?.individual?.address?.countryCode ??
    tx.beneficiary?.individual?.nationality ??
    tx.beneficiary?.company?.jurisdiction
  );
}

export const jurisdictionRule: RiskRule = {
  name: 'Bank jurisdiction',
  check({ tx, customer, correspondent }) {
    const country = counterpartyCountry(tx, correspondent);
    const allowed = settingsFor(customer, tx).jurisdictions;
    if (!country || allowed.includes(country)) return undefined;
    const incoming = tx.type === 'INCOMING';
    return {
      type: 'BANK_JURISDICTION',
      ruleName: this.name,
      target: incoming ? 'SENDER' : 'BENEFICIARY',
      message: `The ${incoming ? "sender's" : "beneficiary's"} bank is in ${country}, which is not allowed for ${direction(tx)} transactions of ${customer.name}`,
    };
  },
};

export const RULES: RiskRule[] = [
  pspOnboardingRule,
  maxAmountRule,
  monthlyLimitRule,
  supportingDocsRule,
  correspondentLicenseRule,
  jurisdictionRule,
];

export function evaluateRisks(ctx: RiskContext): TransactionRisk[] {
  return RULES.map((r) => r.check(ctx)).filter((r): r is TransactionRisk => !!r);
}

const monthOf = (iso: string) => iso.slice(0, 7);

/**
 * Monthly stats for each transaction, from the same client's earlier transactions of the same type and month.
 * Input may be in any order; result is keyed by transaction id.
 */
export function monthlyStatsFor(transactions: Transaction[]): Map<string, MonthlyStats> {
  const sorted = [...transactions].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  const running = new Map<string, MonthlyStats>();
  const out = new Map<string, MonthlyStats>();
  for (const tx of sorted) {
    const k = `${tx.clientId}|${tx.type}|${monthOf(tx.timestamp)}`;
    const current = running.get(k) ?? { count: 0, total: 0 };
    out.set(tx.id, { ...current });
    running.set(k, { count: current.count + 1, total: current.total + gbpAmount(tx) });
  }
  return out;
}
