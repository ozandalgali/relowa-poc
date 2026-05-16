/**
 * EscrowProvider interface (ADR-0007 §3)
 *
 * Provider-agnostic adapter for escrow operations.
 * Three implementations in Phase 1:
 *   - ManualProvider — DB-only stub, always succeeds (POC/dev)
 *   - IyzicoProvider — Iyzico Marketplace API (needs sandbox keys)
 *   - PayTRProvider — fallback (deferred until Iyzico onboarding confirmed)
 *
 * Every method receives an idempotencyKey. The provider MUST
 * use it to prevent double-charges on retry.
 *
 * Currency is always TRY in Phase 1.
 */

export interface EscrowProvider {
  readonly name: "manual" | "iyzico" | "paytr";

  /**
   * Create an escrow hold in the provider's system.
   * Returns the provider's order ID for reference.
   */
  createEscrow(req: {
    orderId: string;
    buyerOrgId: string;
    sellerOrgId: string;
    carrierOrgId?: string;
    wasteAmount: number;
    transportAmount?: number;
    currency: "TRY";
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<{ providerOrderId: string; paymentUrl?: string }>;

  /**
   * Release payment to the seller (producer).
   */
  releaseToSeller(req: {
    providerOrderId: string;
    amount: number;
    idempotencyKey: string;
  }): Promise<{ providerTxId: string }>;

  /**
   * Release payment to the carrier.
   */
  releaseToCarrier(req: {
    providerOrderId: string;
    amount: number;
    idempotencyKey: string;
  }): Promise<{ providerTxId: string }>;

  /**
   * Refund the buyer (recycler) fully or partially.
   */
  refundBuyer(req: {
    providerOrderId: string;
    amount: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<{ providerTxId: string }>;

  /**
   * Verify a webhook signature from the provider.
   * Returns parsed event if valid.
   */
  verifyWebhook(req: {
    headers: Record<string, string>;
    body: string;
  }): Promise<{
    valid: boolean;
    eventId: string;
    orderId: string;
    eventType: string;
    payload: unknown;
  }>;
}
