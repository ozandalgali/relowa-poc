import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

/**
 * EventBridge client — publishes domain events after mutations commit.
 *
 * Local dev: points to LocalStack on localhost:4566
 * Production: uses default AWS credential chain (OIDC / IAM role)
 *
 * Events are fire-and-forget — publish failures are logged but don't
 * affect the HTTP response. The outbox table is the durable source
 * of truth; EventBridge is the real-time fan-out.
 */

const EVENT_BUS_NAME = process.env.EVENTBRIDGE_BUS_NAME ?? "relowa-events";
const EVENT_SOURCE = "relowa.api";

const client = new EventBridgeClient({
  region: process.env.AWS_REGION ?? "eu-central-1",
  endpoint: process.env.AWS_ENDPOINT ?? "http://localhost:4566",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
  },
});

interface PublishEvent {
  detailType: string;
  detail: Record<string, unknown>;
}

export async function publishEvent(event: PublishEvent): Promise<void> {
  try {
    await client.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: EVENT_SOURCE,
            DetailType: event.detailType,
            Detail: JSON.stringify(event.detail),
            EventBusName: EVENT_BUS_NAME,
          },
        ],
      }),
    );
  } catch (err) {
    // Fire-and-forget: EventBridge failures don't fail the HTTP response.
    // The outbox table is the durable event log.
    console.error("EventBridge publish failed (non-blocking):", err);
  }
}
