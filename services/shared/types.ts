// Domain types shared by all Starlix services. Money is always in minor units (pence/cents).

export type EntityType = 'COMPANY' | 'INDIVIDUAL';
export type ClientKind = 'ROOT' | 'PSP' | 'CUSTOMER';

export const ONBOARDING_STATUSES = [
  'NOT_STARTED',
  'WAITING_SIGNUP',
  'PENDING',
  'CHECKS_IN_PROGRESS',
  'CHECKS_FAILED',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
  'EXPIRING',
  'EXPIRED',
  'LICENSE_EXPIRED',
] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export interface Address {
  addressLine1: string;
  addressLine2?: string;
  postCode: string;
  city: string;
  region?: string;
  countryCode: string;
}

export interface Company {
  name: string;
  jurisdiction: string; // ISO 3166 alpha-2
  registrationNumber: string;
  vatNumber?: string;
  regulatorNumber?: string;
  hmrcNumber?: string;
  registeredAddress?: Address;
  operationsAddress?: Address;
}

export interface Individual {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  email?: string;
  phone?: string;
  address?: Address;
  nationality?: string;
  countryOfResidence?: string;
}

/** An entity that can be checked (KYC/KYB/AML). */
export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  company?: Company;
  individual?: Individual;
}

export interface TxSettings {
  maxTransactionAmount: number;
  requireDocsWhenGreaterThan: number;
  transactionTotalPerMonth: number;
  transactionsPerMonth: number;
  jurisdictions: string[];
}

export const DEFAULT_TX_SETTINGS: TxSettings = {
  maxTransactionAmount: 10_000_00,
  requireDocsWhenGreaterThan: 5_000_00,
  transactionTotalPerMonth: 100_000_00,
  transactionsPerMonth: 10,
  jurisdictions: ['GB'],
};

export interface Client {
  id: string;
  kind: ClientKind;
  type: EntityType;
  name: string;
  parentClientId?: string;
  /** Ancestor client ids, root first. Empty for the root client. */
  chain: string[];
  rootClientId: string;
  onboardingStatus: OnboardingStatus;
  company?: Company;
  individual?: Individual;
  uniqueReference?: string;
  incomingTxSettings: TxSettings;
  outgoingTxSettings: TxSettings;
  createdAt: string;
}

export interface StoredFile {
  key: string;
  name: string;
}

export type CorrespondentType = 'BANK' | 'PARTNER';

export interface Correspondent {
  id: string;
  type: CorrespondentType;
  company: Company;
  name: string;
  onboardingStatus: OnboardingStatus;
  clientId: string; // the PSP it belongs to
  rootClientId: string;
  licenseExpires: string; // YYYY-MM-DD
  licenseDocuments: StoredFile[];
  corridors?: string[];
  iban?: string;
}

// ---- Checks ----

export type CheckType = 'AML' | 'KYB' | 'IDV' | 'POA' | 'LIVENESS';
export type CheckStatus = 'PASSED' | 'FAILED' | 'ERROR' | 'IN_PROGRESS';

export const CHECK_LEVELS = {
  COMPANY_BASIC: { entityType: 'COMPANY', label: 'Basic', checkTypes: ['AML'] },
  COMPANY_STANDARD: { entityType: 'COMPANY', label: 'Standard', checkTypes: ['AML', 'KYB'] },
  INDIVIDUAL_MINIMAL: { entityType: 'INDIVIDUAL', label: 'Minimal', checkTypes: ['AML'] },
  INDIVIDUAL_BASIC: { entityType: 'INDIVIDUAL', label: 'Basic', checkTypes: ['AML', 'IDV'] },
  INDIVIDUAL_STANDARD: { entityType: 'INDIVIDUAL', label: 'Standard', checkTypes: ['AML', 'IDV', 'POA'] },
  INDIVIDUAL_ENHANCED: { entityType: 'INDIVIDUAL', label: 'Enhanced', checkTypes: ['AML', 'IDV', 'POA', 'LIVENESS'] },
} as const satisfies Record<string, { entityType: EntityType; label: string; checkTypes: CheckType[] }>;
export type ChecksLevel = keyof typeof CHECK_LEVELS;

export interface EntityCheck {
  id: string;
  formId: string;
  sectionName: string;
  entity: Entity;
  level: ChecksLevel;
  status: CheckStatus;
  message?: string;
  startedAt: string;
  finishedAt?: string;
  expiry?: Partial<Record<CheckType, string>>;
}

// ---- Onboarding ----

export type OnboardingType = 'REGULATED' | 'NON_REGULATED';

export interface SectionRequirement {
  sectionName: string;
  sectionLabel: string;
  checkLevels: ChecksLevel[];
  isCustom: boolean;
}

export interface OnboardingNote {
  authorEmail: string;
  authorUserId: string;
  comment: string;
  timestamp: string;
  relevantSectionNames: string[];
}

export interface OnboardingForm {
  id: string;
  clientId: string;
  clientName: string;
  onboardingType: OnboardingType;
  expiresMonths: number;
  inviteEmail?: string;
  requirements: SectionRequirement[];
  status: OnboardingStatus;
  allSectionsCompleted: boolean;
  checksToRun: number;
  checksFinished: number;
  createdAt: string;
  submittedAt?: string;
  approvedAt?: string;
  createdByClientId: string;
}

export interface Director {
  id: string;
  entity: Entity;
  shareholder: boolean;
  beneficialOwner: boolean;
  source: string;
}

export interface Shareholder {
  id: string;
  entity: Entity;
  sharePercent?: number;
  directorId?: string;
  source: string;
}

/** Section data is stored as a free-form object per section name; entities to check are derived from it. */
export interface OnboardingSection {
  formId: string;
  name: string;
  data: Record<string, any>;
  updatedAt: string;
}

// ---- Transactions ----

export type TransactionType = 'INCOMING' | 'OUTGOING';
export type TransactionStatus = 'APPROVED' | 'ON_HOLD';
export type RiskTarget = 'BENEFICIARY' | 'CORRESPONDENT' | 'CUSTOMER' | 'PSP' | 'SENDER' | 'TRANSACTION';
export type RiskType =
  | 'AMOUNT'
  | 'MONTHLY_LIMIT'
  | 'MISSING_DOCUMENTS'
  | 'PSP'
  | 'CORRESPONDENT'
  | 'BANK_JURISDICTION';

export interface TransactionRisk {
  type: RiskType;
  ruleName: string;
  message: string;
  target: RiskTarget;
}

export interface SupportingDocs {
  type: string;
  files: StoredFile[];
}

export interface Transaction {
  id: string;
  type: TransactionType;
  sentAmount: number;
  receivedAmount: number;
  sentCurrency: string;
  receivedCurrency: string;
  fxRate: number;
  clientId: string;
  pspClientId: string;
  rootClientId: string;
  chain: string[];
  risks: TransactionRisk[];
  status: TransactionStatus;
  supportingDocuments: SupportingDocs[];
  timestamp: string;
  // incoming
  sender?: Entity;
  senderBank?: Company;
  // outgoing
  beneficiary?: Entity;
  beneficiaryBank?: Company;
  correspondentId?: string;
}

export function entityFromIndividual(id: string, individual: Individual): Entity {
  return { id, type: 'INDIVIDUAL', name: `${individual.firstName} ${individual.lastName}`.trim(), individual };
}

export function entityFromCompany(id: string, company: Company): Entity {
  return { id, type: 'COMPANY', name: company.name, company };
}
