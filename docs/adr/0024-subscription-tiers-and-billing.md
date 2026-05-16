# ADR-0024 — Subscription Tiers & SaaS Billing

**Status:** Accepted
**Date:** 2026-05-16
**Decision-makers:** Ozan (lead)

## Context

The CEO's customer-facing pricing matrix (3 tiers × 3 segments) defines Relowa's hybrid revenue model:

- **Subscription revenue** — monthly recurring per org (Free / Pro / Enterprise).
- **Commission revenue** — per-transaction marketplace fee, scaled by subscription tier (Free orgs pay highest commission; Enterprise orgs pay lowest).

PRD-0008 (pricing engine) handles the commission half. This ADR specifies the **subscription half** — the data model, the billing flow, the tier-resolution mechanism that bridges subscription state into commission resolution, and the upgrade/downgrade lifecycle.

Without explicit specs:

- We can't honor the tiered take-rates because we don't know which tier an org is on.
- Renewals, downgrades, and cancellations silently break commission math.
- Enterprise contracts negotiated outside the SaaS flow get lost.
- Subscription-bundled feature gating (e.g. "unlimited listings vs 10/mo") leaks into application code instead of being one structured check.

## Decision

We adopt a **subscription_tiers + org_subscriptions** schema with:

- Per-segment tier catalog (9 rows: Producer × Free/Pro/Enterprise, Recycler × same, Carrier × same).
- Per-org current subscription with effective-date semantics.
- Subscription history (audit trail of upgrades, downgrades, cancellations).
- Tier-driven feature flags consumed by the API layer.
- Iyzico-compatible recurring billing (M4+) using the same provider adapter pattern as escrow (PRD-0006).
- Free tier requires no billing; auto-applied to every new org.

### 1. Schema (M4 — lands alongside pricing engine + escrow)

```sql
CREATE TYPE subscription_status AS ENUM (
  'active',          -- currently subscribed, billing in good standing
  'past_due',        -- payment failed, grace period
  'cancelled',       -- explicitly cancelled, runs until period_end
  'expired',         -- past period_end, downgraded to free
  'trialing'         -- trial period, not yet billing
);

-- The catalog of available tiers. Static reference, seeded.
CREATE TABLE subscription_tiers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment         TEXT NOT NULL,                          -- 'producer' | 'recycler' | 'carrier'
  tier_code       TEXT NOT NULL,                          -- 'free' | 'pro' | 'enterprise'
  display_name    TEXT NOT NULL,                          -- 'Producer Pro'
  description     TEXT,
  monthly_price   numeric(10,2) NOT NULL DEFAULT 0,       -- 0 for free; NULL allowed for enterprise custom
  currency        TEXT NOT NULL DEFAULT 'TRY',
  is_custom       BOOLEAN NOT NULL DEFAULT false,         -- enterprise = true (price negotiated)
  fee_schedule_id UUID,                                    -- FK to fee_schedules; resolved at apply time
  features        jsonb NOT NULL DEFAULT '{}'::jsonb,     -- flag set, see §4
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (segment, tier_code)
);

-- One row per active subscription. History via versioning (effective_from/until).
CREATE TABLE org_subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_tier_id  UUID NOT NULL REFERENCES subscription_tiers(id),
  status                subscription_status NOT NULL DEFAULT 'active',
  effective_from        TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_until       TIMESTAMPTZ,                        -- null = open-ended (current)
  trial_ends_at         TIMESTAMPTZ,
  billing_cycle_start   TIMESTAMPTZ,                        -- aligned with monthly billing day
  billing_cycle_end     TIMESTAMPTZ,
  custom_price          numeric(10,2),                      -- override for enterprise
  external_subscription_id TEXT,                            -- Iyzico subscription ID
  reason                TEXT,                                -- audit context
  created_by            UUID REFERENCES users(id),           -- self-serve via web; or staff (admin)
  created_by_staff      UUID REFERENCES internal_staff(id),  -- if super_admin assigned
  cancelled_at          TIMESTAMPTZ,
  cancellation_reason   TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT org_subscriptions_no_overlap
    EXCLUDE USING gist (
      org_id WITH =,
      tstzrange(effective_from, COALESCE(effective_until, 'infinity'::timestamptz)) WITH &&
    ) WHERE (status NOT IN ('cancelled', 'expired'))
);

CREATE INDEX org_subscriptions_active_idx
  ON org_subscriptions(org_id, effective_from)
  WHERE status = 'active';

-- Subscription invoice records. Separate from e-fatura invoices for waste tenders.
CREATE TABLE subscription_invoices (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_subscription_id      UUID NOT NULL REFERENCES org_subscriptions(id),
  org_id                   UUID NOT NULL REFERENCES organizations(id),
  invoice_number           TEXT NOT NULL UNIQUE,
  period_start             TIMESTAMPTZ NOT NULL,
  period_end               TIMESTAMPTZ NOT NULL,
  amount                   numeric(10,2) NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'TRY',
  status                   TEXT NOT NULL,                    -- 'draft' | 'issued' | 'paid' | 'failed' | 'cancelled'
  paid_at                  TIMESTAMPTZ,
  external_invoice_id      TEXT,                              -- e-fatura ID
  external_payment_id      TEXT,                              -- Iyzico payment ID
  payment_method           TEXT,                              -- 'card' | 'bank_transfer' | 'manual'
  failed_attempts          INTEGER NOT NULL DEFAULT 0,
  next_retry_at            TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX subscription_invoices_org_idx ON subscription_invoices(org_id, period_start DESC);
CREATE INDEX subscription_invoices_unpaid_idx
  ON subscription_invoices(next_retry_at)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;

-- Feature usage counters (for usage-capped tiers like "10 listings/mo")
CREATE TABLE org_usage_counters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  counter_key     TEXT NOT NULL,                              -- 'listings_per_month', 'bids_per_month', etc.
  period_start    TIMESTAMPTZ NOT NULL,                       -- start of measurement window
  period_end      TIMESTAMPTZ NOT NULL,
  count           INTEGER NOT NULL DEFAULT 0,
  limit_at_period_start INTEGER,                              -- the cap that applied; null = unlimited
  UNIQUE (org_id, counter_key, period_start)
);

CREATE INDEX org_usage_active_idx ON org_usage_counters(org_id, counter_key)
  WHERE period_end > now();
```

### 2. RLS

- `subscription_tiers` — RLS disabled; readable via API as reference, mutations are `relowa_admin` only.
- `org_subscriptions` — RLS enabled; org members see only their own org's row.
- `subscription_invoices` — RLS enabled; org members see only their own org's invoices.
- `org_usage_counters` — RLS enabled; org members see only their own org's counters.

### 3. Tier resolution (the bridge to PRD-0008 pricing engine)

The pricing engine's `computeFees` function (PRD-0008 §4) now resolves the schedule via subscription:

```ts
async function resolveSchedule(orgId, transactionType, at) {
  // 1. Override takes precedence
  const override = await db.query.feeScheduleOverrides.findFirst({
    where: and(
      eq(orgId, orgId),
      eq(transactionType, transactionType),
      lte(effectiveFrom, at),
      or(isNull(effectiveUntil), gt(effectiveUntil, at))
    ),
    orderBy: desc(effectiveFrom),
  });
  if (override) return override.scheduleId;

  // 2. Resolve org's active subscription
  const subscription = await db.query.orgSubscriptions.findFirst({
    where: and(
      eq(orgId, orgId),
      eq(status, 'active'),
      lte(effectiveFrom, at),
      or(isNull(effectiveUntil), gt(effectiveUntil, at))
    ),
    orderBy: desc(effectiveFrom),
  });

  const tier = subscription
    ? await db.query.subscriptionTiers.findFirst({ where: eq(id, subscription.subscriptionTierId) })
    : await db.query.subscriptionTiers.findFirst({
        where: and(eq(segment, orgSegment(orgId)), eq(tierCode, 'free'))
      });

  // 3. Resolve the segment-specific schedule for that tier
  const scheduleName = `${tier.segment}-${tier.tierCode}`;
  const schedule = await db.query.feeSchedules.findFirst({
    where: and(eq(name, scheduleName), eq(transactionType, transactionType)),
  });

  return schedule?.id ?? throw new Error('no fee schedule for tier');
}
```

**Resolution priority:** override → subscription-tier schedule → free-tier fallback.

### 4. Feature flags via tier

Each tier's `features` jsonb encodes the gating:

```jsonc
// Producer Free
{
  "max_listings_per_month": 10,
  "esg_dashboard": "basic",
  "support_channel": "email",
  "advanced_analytics": false,
  "api_access": false,
  "multi_facility": false,
  "iso_14001_compliance": false
}

// Producer Pro
{
  "max_listings_per_month": null,                  // null = unlimited
  "esg_dashboard": "advanced",
  "support_channel": "priority",
  "advanced_analytics": true,
  "api_access": false,
  "multi_facility": false,
  "carbon_certificates": true,
  "waste_analysis_reports": true
}

// Producer Enterprise
{
  "max_listings_per_month": null,
  "esg_dashboard": "advanced_plus_consulting",
  "support_channel": "dedicated_am",
  "advanced_analytics": true,
  "api_access": true,
  "multi_facility": true,
  "carbon_certificates": true,
  "waste_analysis_reports": true,
  "iso_14001_compliance": true,
  "sla_guarantee": "99.9%",
  "white_label": "optional",
  "erp_integration": true
}
```

The middleware checks feature gates at the route level:

```ts
// Example: enforce listings-per-month cap
app.post('/tenders', requireFeature('max_listings_per_month'), async (c) => { ... });

async function requireFeature(key) {
  return async (c, next) => {
    const orgId = c.get('orgId');
    const tier = await getCurrentTier(orgId);
    const limit = tier.features[key];

    if (limit === null) return next();  // unlimited
    if (limit === undefined || limit === false) {
      throw new HTTPException(403, `Feature ${key} not available on ${tier.tierCode}`);
    }

    // Usage check for numeric caps
    const counter = await getMonthlyCounter(orgId, key);
    if (counter.count >= limit) {
      throw new HTTPException(429, `Limit of ${limit} reached for ${key}; upgrade to continue`);
    }

    counter.count++;
    await counter.save();
    return next();
  };
}
```

### 5. Free-tier auto-assignment

Every new org is assigned a Free-tier subscription at creation:

```sql
-- Trigger on organizations INSERT
CREATE FUNCTION assign_free_subscription() RETURNS trigger AS $$
DECLARE
  v_tier_id UUID;
BEGIN
  SELECT id INTO v_tier_id
  FROM subscription_tiers
  WHERE segment = NEW.type::text AND tier_code = 'free' AND is_active = true;

  INSERT INTO org_subscriptions (org_id, subscription_tier_id, status, effective_from, reason)
  VALUES (NEW.id, v_tier_id, 'active', now(), 'auto-assigned on org creation');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER assign_free_subscription_trigger
AFTER INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION assign_free_subscription();
```

### 6. Upgrade / downgrade lifecycle

**Self-serve upgrade (Free → Pro):**

```
User clicks "Upgrade to Pro" in /ayarlar/subscription
  → POST /api/subscriptions/upgrade { tier_code: 'pro' }
  1. Validate tier exists and is_active
  2. Call Iyzico CreateSubscription via SubscriptionProvider adapter
  3. On success:
     - End current subscription: UPDATE org_subscriptions
         SET effective_until = now(), status = 'expired'
         WHERE org_id = $1 AND status = 'active'
     - Insert new row with status = 'active', effective_from = now()
     - Insert first subscription_invoice for the new period
  4. Notification: 'subscription.upgraded' to admin user
  5. audit_events row written
  6. Pricing engine immediately resolves new tier on next transaction
```

**Downgrade (Pro → Free):**

```
1. User clicks "Cancel subscription"
2. Set current subscription status = 'cancelled' (stays effective until billing_cycle_end)
3. At billing_cycle_end: scheduled Lambda transitions to 'expired'
   and inserts a new free-tier subscription effective immediately
4. No billing for cancelled period
5. Notification: 'subscription.cancelled' on cancellation, 'subscription.downgraded' at period end
```

**Enterprise (manual via super_admin):**

```
1. Sales team negotiates contract offline
2. super_admin opens /admin/organizations/:id/subscription
3. Selects 'enterprise' tier; enters custom_price (or 0 for white-glove)
4. Optionally creates a fee_schedule_override for bespoke commission rate
5. effective_from defaults to now(); can be future-dated
6. reason field: contract reference (mandatory per ADR-0014)
7. admin_audit_log row written
8. compliance-specialist auto-invoked (pricing change trigger)
```

### 7. Billing cycle

Monthly cycle aligned to org's `billing_cycle_start`:

```
Day 1 of cycle:
  - Iyzico auto-charges the card on file
  - Webhook → subscription_invoice.status = 'paid' OR 'failed'

Day 1 failed:
  - Retry day 3
  - Day 7: status = 'past_due', email reminder
  - Day 14: status = 'past_due', second reminder
  - Day 21: status = 'past_due', final warning
  - Day 30: status = 'expired', auto-downgrade to free, notification

Day 30 in past_due:
  - Org's tier reverts to Free
  - Active features removed (counters reset)
  - Existing transactions in flight unaffected (escrow state machine continues)
```

### 8. SubscriptionProvider adapter (PRD-0006 pattern)

```ts
export interface SubscriptionProvider {
  readonly name: 'manual' | 'iyzico' | 'paytr';

  createSubscription(req: {
    orgId: string;
    tierId: string;
    paymentMethod: PaymentMethodRef;
    amount: number;
    currency: 'TRY';
    billingCycleDay: number;
    metadata: Record<string, string>;
  }): Promise<{
    providerSubscriptionId: string;
    nextChargeAt: Date;
  }>;

  cancelSubscription(req: {
    providerSubscriptionId: string;
    atPeriodEnd: boolean;        // true = cancel at end; false = immediate
  }): Promise<{ cancelledAt: Date }>;

  updateSubscription(req: {
    providerSubscriptionId: string;
    newTierId: string;
    proration: 'immediate' | 'next_cycle';
  }): Promise<{ effectiveAt: Date }>;

  verifyWebhook(req: { headers; body }): Promise<{
    valid: boolean;
    eventId: string;
    subscriptionId: string;
    eventType: 'invoice_paid' | 'invoice_failed' | 'cancelled' | 'reactivated';
    payload: unknown;
  }>;
}
```

P1 ships `ManualSubscriptionProvider` only (writes to `manual_subscriptions` table; no real billing). Iyzico subscription adapter is ADR-0027 territory (a sibling to ADR-0027 escrow).

### 9. KVKK considerations

- Card data never touches our system — provider tokenizes; we store `external_subscription_id` only.
- Billing addresses on `organizations.address` already; no new PII surface.
- Invoice history viewable + exportable by org members (KVKK m.13 portability).
- Cancellation does not delete subscription history — soft-delete with cancellation_reason for audit and reactivation paths.

### 10. Operational metrics

| Metric | Target | Source |
|---|---|---|
| Free → Pro conversion rate | > 15% within 90 days | `org_subscriptions` history |
| Pro retention (12 month) | > 80% | Cohort analysis on `cancelled_at` |
| Average revenue per Pro user (ARPU) | ~₺2 700 / mo | `subscription_invoices` paid |
| Payment failure rate | < 3% | `subscription_invoices.failed_attempts` |
| Time from upgrade click to active tier | < 30s | Funnel |

### 11. Frontend surface

Per the CEO matrix, the **pricing page** lives at `/fiyatlandirma` (marketing) and `/ayarlar/abonelik` (operator):

- Marketing page: comparison table per segment, current tier badge if logged in.
- Operator settings: current tier, next billing date, billing history, change-tier flow, cancel flow.
- All copy from `messages/tr,en/billing.json`.

### 12. Cost model

| Item | Pilot scale | 10x scale |
|---|---|---|
| Iyzico subscription fee | 2.99% + ₺0.30 per charge | Same |
| Email notifications (SES) | Negligible (covered ADR-0018) | Same |
| RDS rows / storage | Negligible | Negligible |
| **Net effective take** | ~2.7% net after Iyzico costs (above subscription) | Same |

## Consequences

### Positive

- **The hybrid model is structural** — schema, engine, and resolution all encode it.
- **Free tier auto-applies** — no special-case for new orgs.
- **Tier change is the override mechanism** — no special override needed for routine upgrades.
- **Per-tenant fee_schedule_overrides still work** for enterprise bespoke.
- **Feature flags are tier-driven** — application code stays simple.
- **Usage caps tracked centrally** — same pattern for any future cap.
- **Audit trail** of every subscription change (history table + admin_audit_log).
- **No card data in our system** — provider tokenization.

### Negative

- **4 new tables** in M4. Mitigated by clear pattern reuse.
- **Resolution function does 2-3 lookups per transaction** — mitigated by Redis cache (1-min TTL on org's current tier).
- **Downgrade UX is delayed** — paid users keep features until cycle end. Industry standard but occasionally confusing.
- **Free tier has no per-feature cap mechanism for non-numeric features** — feature flags are boolean or null. Add additional structure if needed (Phase 2).

## Future plans

- **Annual billing** with discount — Phase 2.
- **Per-seat pricing** for Enterprise — Phase 3 if user count drives value.
- **Add-on packs** (extra listings, extra users, extra integrations) — Phase 2.
- **Trial mode** — 30-day free Pro trial for new orgs — Phase 2.
- **Promotional discounts** — referral codes, anniversary discounts — Phase 2.
- **Volume rebates** at the commission layer (volume × tier combinations) — Phase 2.
- **Multi-currency** subscription (EUR for EU expansion) — Phase 3.
- **Self-serve Enterprise upgrade** with embedded sales flow — Phase 3.
- **Subscription billing analytics dashboard** — MRR, churn, CAC, LTV — Phase 2.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Single-tier model (no subscription) | Reverts to "transaction fees only"; rejected per CEO matrix. |
| External billing platform (Stripe Billing) | Adds third-party; KVKK paperwork; Iyzico-Turkish-compliance preferred. |
| Subscription as feature toggle without tier table | Loses the explicit segment × tier matrix; harder to query for analytics. |
| Per-feature pricing | Customers find tiered pricing easier to evaluate. Industry default. |
| Yearly-only billing | Reduces conversion friction higher. Monthly default; yearly optional later. |
| Subscription paid via wallet balance | Adds operational complexity; pay-as-you-go is simpler. |

## Reference

- PRD-0008 — Pricing engine (the commission half; resolves schedule via subscription)
- PRD-0006 — Provider integration specs (SubscriptionProvider adapter pattern mirrors EscrowProvider)
- ADR-0007 — Step Functions escrow (similar webhook/provider pattern)
- ADR-0014 — Internal staff RBAC (super_admin owns enterprise tier assignment)
- ADR-0018 — Notifications (subscription lifecycle events fire here)
- ADR-0022 — Rate limiting (per-tier usage caps complement rate limits)
- Iyzico Subscription: https://docs.iyzico.com/subscription/
