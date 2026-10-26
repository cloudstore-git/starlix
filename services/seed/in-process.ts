import * as clients from '../clients/handler';
import * as onboarding from '../onboarding/handler';
import * as checks from '../checks/handler';
import * as transactions from '../transactions/handler';
import type { EventMap } from '../shared/events';

/** Delivers an event to the same handlers the EventBridge rules in the CDK stack target. */
export async function deliverInProcess(name: string, detail: any) {
  switch (name) {
    case 'OnboardingSubmitted':
      await checks.runChecks(detail as EventMap['OnboardingSubmitted']);
      break;
    case 'ChecksCompleted':
    case 'UserActivated':
      await onboarding.onEvent(name, detail);
      break;
    case 'OnboardingStatusChanged':
      await clients.onEvent(name, detail);
      await transactions.onEvent(name, detail);
      break;
    case 'TxSettingsChanged':
      await transactions.onEvent(name, detail);
      break;
  }
}
