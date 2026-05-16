/**
 * ManualProvider — DB-only stub implementation (ADR-0007 §3)
 *
 * Used for POC/dev. All operations succeed immediately.
 * Stores the intent in escrow_transactions for traceability.
 * No real money moves — this is the test/demo provider.
 */

import { EscrowProvider } from "./interface";

let txCounter = 0;

function fakeTxId(): string {
  txCounter++;
  return `manual-tx-${Date.now()}-${txCounter}`;
}

export class ManualProvider implements EscrowProvider {
  readonly name = "manual" as const;

  async createEscrow(req: Parameters<EscrowProvider["createEscrow"]>[0]) {
    return {
      providerOrderId: `manual-order-${req.orderId}`,
      paymentUrl: `http://localhost:3000/escrow/${req.orderId}/simulate-payment`,
    };
  }

  async releaseToSeller(_req: Parameters<EscrowProvider["releaseToSeller"]>[0]) {
    return { providerTxId: fakeTxId() };
  }

  async releaseToCarrier(_req: Parameters<EscrowProvider["releaseToCarrier"]>[0]) {
    return { providerTxId: fakeTxId() };
  }

  async refundBuyer(_req: Parameters<EscrowProvider["refundBuyer"]>[0]) {
    return { providerTxId: fakeTxId() };
  }

  async verifyWebhook(req: Parameters<EscrowProvider["verifyWebhook"]>[0]) {
    const body = JSON.parse(req.body);
    return {
      valid: true, // ManualProvider trusts everything in dev
      eventId: body.event_id ?? fakeTxId(),
      orderId: body.order_id ?? "unknown",
      eventType: body.event_type ?? "unknown",
      payload: body,
    };
  }
}
