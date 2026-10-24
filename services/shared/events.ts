import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { OnboardingStatus } from './types';

/** Events exchanged between services over EventBridge. `tenant` is always included. */
export interface EventMap {
  OnboardingSubmitted: {
    tenant: string;
    formId: string;
    clientId: string;
    checks: { sectionName: string; entity: import('./types').Entity; level: import('./types').ChecksLevel }[];
  };
  ChecksCompleted: { tenant: string; formId: string; total: number; passed: number; failed: number; errors: number };
  OnboardingStatusChanged: { tenant: string; formId: string; clientId: string; status: OnboardingStatus };
  TxSettingsChanged: { tenant: string; clientId: string };
  UserActivated: { tenant: string; clientId: string; email: string };
}
export type EventName = keyof EventMap;

export const EVENT_SOURCE = 'starlix';

type Sink = (name: string, detail: unknown) => Promise<void>;

const eventBridgeSink: Sink = async (name, detail) => {
  const client = new EventBridgeClient({});
  const res = await client.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: EVENT_SOURCE,
          DetailType: name,
          Detail: JSON.stringify(detail),
        },
      ],
    }),
  );
  if (res.FailedEntryCount) throw new Error(`Failed to publish ${name}: ${JSON.stringify(res.Entries)}`);
};

let sink: Sink = eventBridgeSink;

/** Tests, the local server and the seed swap the sink to route events in-process. Returns the previous sink. */
export function setEventSink(s: Sink): Sink {
  const previous = sink;
  sink = s;
  return previous;
}

export async function publish<K extends EventName>(name: K, detail: EventMap[K]): Promise<void> {
  await sink(name, detail);
}
