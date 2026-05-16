/**
 * webhooks.test.ts — Provider webhook handler
 */
import { describe, it, expect } from "vitest";
import { api } from "./helpers";

describe("Provider webhooks", () => {
  it("accepts valid webhook (200)", async () => {
    const res = await api("/api/webhooks/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: "evt-test-001",
        order_id: "manual-order-test",
        event_type: "payment.completed",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("processed");
  });

  it("returns already_processed on replay (200)", async () => {
    // Same event_id = idempotent replay
    const res = await api("/api/webhooks/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: "evt-test-001",
        order_id: "manual-order-test",
        event_type: "payment.completed",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("already_processed");
  });

  it("processes different event_id (200)", async () => {
    const res = await api("/api/webhooks/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: "evt-test-002",
        order_id: "manual-order-another",
        event_type: "payment.refunded",
      }),
    });
    expect(res.status).toBe(200);
  });
});
