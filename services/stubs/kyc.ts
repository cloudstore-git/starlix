import { CHECK_LEVELS, CheckStatus, CheckType, ChecksLevel, Entity } from '../shared/types';

/**
 * Stand-in for SumSub (individuals) and CreditSafe/KYB/AML screening (companies).
 * Deterministic so demos are repeatable:
 *  - a name containing "FAIL" fails (sanctions/PEP hit)
 *  - a name containing "ERROR" returns a provider error
 *  - everything else passes; proof-of-address results expire after 90 days
 */
export interface CheckResult {
  status: CheckStatus;
  message: string;
  expiry?: Partial<Record<CheckType, string>>;
}

export function runStubCheck(entity: Entity, level: ChecksLevel, now = new Date()): CheckResult {
  const types = CHECK_LEVELS[level].checkTypes as readonly CheckType[];
  const name = entity.name.toUpperCase();
  if (name.includes('ERROR')) {
    return { status: 'ERROR', message: `Provider unavailable while checking ${entity.name} (stub)` };
  }
  if (name.includes('FAIL')) {
    const failed = types.includes('AML') ? 'AML screening: possible sanctions or PEP match' : `${types[0]} check failed`;
    return { status: 'FAILED', message: `${failed} for ${entity.name} (stub)` };
  }
  const expiry: Partial<Record<CheckType, string>> = {};
  if (types.includes('POA')) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + 90);
    expiry.POA = d.toISOString().slice(0, 10);
  }
  return { status: 'PASSED', message: `${types.join(', ')} passed (stub)`, expiry };
}
