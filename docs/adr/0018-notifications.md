# ADR-0018 — Notifications (Email · SMS · Web Push · In-app)

**Status:** Accepted
**Date:** 2026-05-14
**Decision-makers:** Ozan (lead)

## Context

Many events in the platform demand a user notification:

- Tender published → all matching recyclers
- Bid received → producer
- Tender won → recycler + producer
- Escrow funded / released / disputed → involved parties
- Carrier ad bid received / awarded → recycler + carrier
- Shipment status changes → producer + recycler
- Registration / OTP / password reset → user
- Verification approved / rejected → primary user
- KVKK request acknowledged → user
- Admin announcements → all users
- Billing / invoice issued → org accounting

Without a unified system:
- Every feature reinvents notification routing.
- User preferences (email yes, SMS no) don't propagate.
- We can't audit "did we tell the user?" for compliance.
- Notification storms (many bids on one tender) flood inboxes.
- Deliverability degrades because we send unsystematically.

## Decision

We adopt a **multi-channel notification system** with four channels (email, SMS, Web Push, in-app), per-user preferences, a single dispatcher, and queue-based delivery.

```
┌──────────────────────────────────────────────────────────┐
│  Outbox event (ADR-0006)                                  │
│  e.g. { event_type: 'bid.placed', aggregate: 'tender' }   │
└────────────────┬─────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────────────────────┐
│  notification-dispatcher Lambda                           │
│  - Maps event → notification template + recipients        │
│  - Filters by user preferences                            │
│  - Inserts notifications row + channel rows               │
│  - Enqueues SQS messages per channel                      │
└────────────────┬─────────────────────────────────────────┘
                 ↓
     ┌───────────┴────────────────────┐
     ↓                ↓               ↓
SES (email)      SMS provider    Web Push (VAPID)
                                 + in-app (DB row)
```

### 1. Channels

| Channel | Provider | When |
|---|---|---|
| **Email** | AWS SES (eu-central-1) | Default for all non-urgent events |
| **SMS** | Netgsm or Iletimerkezi (abstracted via adapter) | OTP, urgent state changes (auction-won, escrow-disputed) |
| **Web Push** | VAPID via service worker | Real-time browser updates (bid received) — opt-in only |
| **In-app** | Database row → real-time UI | Always; the source of truth notifications feed in `/bildirimler` |

In-app is **always written** even when other channels are sent. This guarantees a permanent record for the user.

### 2. Schema (lands in M3 alongside outbox + AppSync)

```sql
CREATE TYPE notification_channel AS ENUM ('email', 'sms', 'web_push', 'in_app');
CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'delivered', 'failed', 'bounced', 'read');

-- One canonical notification per (event, recipient_user). Has 1..N channel rows.
CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id          UUID REFERENCES organizations(id),
  template_key    TEXT NOT NULL,                          -- e.g. 'bid.placed.to_producer'
  payload         jsonb NOT NULL,                          -- variables for template rendering
  related_entity  TEXT,                                    -- 'tender' | 'carrier_ad' | 'escrow' | ...
  related_id      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at         TIMESTAMPTZ                              -- when user opened in-app
);

CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications(user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_entity_idx ON notifications(related_entity, related_id);

-- One row per channel attempted for a notification.
CREATE TABLE notification_channels (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id      UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel              notification_channel NOT NULL,
  destination          TEXT NOT NULL,                      -- email, phone, push endpoint
  status               notification_status NOT NULL DEFAULT 'queued',
  provider_message_id  TEXT,                                -- SES message-id, SMS provider ref
  attempts             INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  queued_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at              TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  failed_at            TIMESTAMPTZ
);

CREATE INDEX notification_channels_status_idx ON notification_channels(status);

-- Per-user preferences. Defaults applied if no row.
CREATE TABLE notification_preferences (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_key   TEXT NOT NULL,                            -- '*' matches all
  channel        notification_channel NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  quiet_hours_start TIME,                                  -- e.g. '22:00'
  quiet_hours_end   TIME,                                  -- e.g. '08:00'
  PRIMARY KEY (user_id, template_key, channel)
);

-- Suppression list for email deliverability (bounce / complaint).
CREATE TABLE notification_suppressions (
  email          TEXT PRIMARY KEY,
  reason         TEXT NOT NULL,                            -- 'bounce' | 'complaint' | 'manual'
  added_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by       TEXT NOT NULL                             -- 'ses_webhook' | staff_id
);
```

**RLS:**
- `notifications`, `notification_channels`, `notification_preferences` — users see only their own rows.
- `notification_suppressions` — admin-only.

### 3. Template registry

Templates are code-defined constants, not DB rows (P1 simplicity):

```ts
// packages/notifications/templates.ts
export const NOTIFICATION_TEMPLATES = {
  // Auth
  'auth.otp':                       { channels: ['sms'], severity: 'urgent' },
  'auth.password_reset':            { channels: ['email'], severity: 'normal' },
  'auth.invitation':                { channels: ['email'], severity: 'normal' },

  // Onboarding
  'onboarding.welcome':             { channels: ['email'], severity: 'normal' },
  'onboarding.verified':            { channels: ['email', 'in_app'], severity: 'normal' },
  'onboarding.rejected':            { channels: ['email', 'in_app'], severity: 'normal' },

  // Marketplace
  'tender.published.to_recyclers':  { channels: ['email', 'in_app', 'web_push'], severity: 'normal' },
  'tender.bid_received':            { channels: ['in_app', 'web_push'], severity: 'normal' },
  'tender.won':                     { channels: ['email', 'sms', 'in_app'], severity: 'urgent' },
  'tender.lost':                    { channels: ['in_app'], severity: 'low' },

  // Logistics
  'carrier_ad.bid_received':        { channels: ['in_app', 'web_push'], severity: 'normal' },
  'carrier_ad.awarded':             { channels: ['email', 'in_app'], severity: 'normal' },
  'shipment.in_transit':            { channels: ['in_app'], severity: 'normal' },
  'shipment.delivered':             { channels: ['email', 'in_app'], severity: 'normal' },

  // Escrow
  'escrow.funded':                  { channels: ['email', 'in_app'], severity: 'normal' },
  'escrow.released':                { channels: ['email', 'sms', 'in_app'], severity: 'urgent' },
  'escrow.disputed':                { channels: ['email', 'sms', 'in_app'], severity: 'urgent' },
  'escrow.failed':                  { channels: ['email', 'sms', 'in_app'], severity: 'urgent' },

  // Billing / e-fatura
  'invoice.issued':                 { channels: ['email', 'in_app'], severity: 'normal' },
  'invoice.payment_received':       { channels: ['email', 'in_app'], severity: 'normal' },

  // KVKK
  'kvkk.request_acknowledged':      { channels: ['email'], severity: 'normal' },
  'kvkk.export_ready':              { channels: ['email'], severity: 'normal' },
  'kvkk.erasure_completed':         { channels: ['email'], severity: 'urgent' },

  // Admin
  'admin.account_suspended':        { channels: ['email'], severity: 'urgent' },
  'admin.announcement':             { channels: ['in_app'], severity: 'low' },
} as const;
```

Each template has a TR + EN body in `messages/{tr,en}/notifications.json`, keyed by template_key.

**Defaults that respect preferences:**
- A user can disable any non-urgent channel for any template.
- `urgent` severity templates **cannot** be disabled — operational + regulatory necessity.
- `auth.otp` is sms-only and cannot be redirected to email (security).

### 4. Dispatcher logic

The `notification-dispatcher` Lambda is triggered by outbox-driven events (ADR-0006). For each event:

```
1. Determine template_key from event_type
2. Determine recipients:
     - bid.placed → tender owner (producer admin/ops)
     - tender.published → recyclers in region matching material_type
     - escrow.released → both buyer (recycler) and seller (producer) accounting
   Recipient resolution is event-type-specific (functions in dispatcher).
3. For each recipient user:
     a. Insert notifications row
     b. Determine effective channels = template.channels ∩ user_prefs (urgent ignores prefs)
     c. Check quiet_hours; defer non-urgent if in quiet zone
     d. For each channel:
          - Insert notification_channels row (status='queued')
          - Enqueue SQS message: { notification_channel_id, channel, payload }
4. Return — actual sending happens in channel worker Lambdas
```

Quiet hours implementation: if `now()` falls in user's quiet window and severity is `normal` or `low`, the channel row is queued but with `sent_at = NULL` and a `send_after = end_of_quiet_zone` timestamp. A separate sweep Lambda picks up post-quiet-hours.

### 5. Channel workers (one Lambda per channel)

**Email worker (`notification-email-sender`):**
- Pulls from `email-queue` SQS.
- Looks up template + payload + user locale → renders with `messages/{locale}/notifications.json`.
- Calls SES SendEmail with configuration set headers for bounce/complaint tracking.
- Updates `notification_channels` row: `status='sent'`, `provider_message_id`.
- Handles SES bounce/complaint webhooks → updates row + adds to `notification_suppressions`.

**SMS worker (`notification-sms-sender`):**
- Pulls from `sms-queue` SQS.
- Renders short template (TR, 1 SMS unit when possible).
- Calls SMS adapter (`packages/sms/provider.interface.ts` — Netgsm / Iletimerkezi).
- Updates row.

**Web Push worker (`notification-push-sender`):**
- Pulls from `push-queue` SQS.
- Fetches user's push subscriptions from `web_push_subscriptions` table.
- Sends VAPID-signed push to each endpoint.
- Cleans up dead subscriptions (410 Gone responses).

**In-app worker — not needed.** The `notifications` row IS the in-app notification. The UI subscribes via AppSync to `onNotificationCreated` channel scoped to the user.

### 6. SMS provider adapter

Like other providers (PRD-0006), abstracted:

```ts
// packages/sms/provider.interface.ts
export interface SmsProvider {
  readonly name: 'manual' | 'netgsm' | 'iletimerkezi';
  send(req: {
    to: string;                  // E.164 format
    body: string;                // < 160 chars for single SMS
    idempotencyKey: string;
  }): Promise<{
    providerMessageId: string;
    cost?: number;
  }>;
}
```

`ManualProvider` in dev logs to console + writes to `manual_sms_log` table; doesn't send real SMS.

### 7. SES configuration

- **Sending domain:** `relowa.com` (transactional) + `notifications.relowa.com` (marketing); separate identities for reputation.
- **DKIM:** signed via Route53 records (Terraform-managed).
- **SPF:** `v=spf1 include:amazonses.com -all`.
- **DMARC:** `v=DMARC1; p=quarantine; rua=mailto:dmarc@relowa.com`.
- **Configuration sets:** `transactional` (logs bounces/complaints) + `marketing`.
- **Sandbox → production:** request AWS to lift the SES sandbox limit before pilot launch (~24h turnaround).
- **Bounce handling:** SES SNS topic → Lambda → `notification_suppressions` insert.

### 8. Web Push subscription

```sql
CREATE TABLE web_push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh_key  TEXT NOT NULL,
  auth_key    TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used   TIMESTAMPTZ
);
```

VAPID keys generated once, stored in AWS Secrets Manager (ADR-0023). Frontend service worker subscribes on user opt-in via `/ayarlar/bildirimler` toggle.

### 9. In-app notification UI

Figma shows a notification bell in topbar. Component spec:

- Badge with unread count (capped at 99+).
- Click → dropdown with recent 20 notifications.
- Each item: icon, template-localized title, relative time, click → deep link.
- "Mark all read" action.
- "Tüm bildirimler" link → `/bildirimler` full page.

The page lives in `apps/web/(app)/bildirimler/page.tsx`, paginates from `notifications` table.

Real-time updates: AppSync subscription `onNotificationCreated(user_id: $me)` triggered by outbox.

### 10. KVKK considerations

- Suppression lists are PII — protected by RLS, admin-only access.
- Notifications can contain PII (e.g. "Bid received from EkoMetal A.Ş. for ₺50,000") — stored with same protection as `tenders` / `bids` (via RLS).
- Marketing emails require **separate opt-in**; transactional sends don't (legitimate interest under KVKK).
- Unsubscribe link in marketing footer (Phase 2 — no marketing emails in P1).
- Quiet hours respected for normal severity; urgent always sends per regulatory necessity (escrow notifications particularly).

### 11. Cost model (rough)

At 50–100 producers × 20 events/day average:

- **SES:** ~50k emails/month × $0.10/1000 = **$5/month** in `eu-central-1`
- **SMS:** ~5k SMS/month × ₺0.05/each = **~$8/month** (Netgsm-tier)
- **Web Push:** free (VAPID-based, no provider)
- **Lambda invocations:** ~150k/month × $0.20/1M = **$0.03/month**
- **SQS:** ~150k messages × $0.40/1M = **$0.06/month**

**Total: ~$15/month** for notifications at pilot scale. Negligible.

## Consequences

### Positive

- **Single dispatcher** — every event-driven notification routes through one path.
- **Channel preferences are per-template** — granular control without spam.
- **Urgent severity bypasses prefs** — operationally + regulatorily necessary.
- **In-app is always written** — permanent record, supports KVKK audit ("did we tell them?").
- **Provider-agnostic SMS** — fallback if one provider degrades.
- **Quiet hours respected** for non-urgent.
- **SES bounce/complaint loop closes automatically.**

### Negative

- **Many tables** — 5 new tables. Mitigated by clear ownership (one squad's work).
- **Quiet hours + retries means delays** — a quiet-hours notification arriving 8h late is fine for normal severity; we accept that.
- **Web Push works only on supported browsers** (Chrome, Edge, Firefox; not Safari iOS pre-16.4). Mitigated by it being an extra channel, not a primary one.
- **No notification batching in P1** — 50 bids on one tender = 50 emails. Phase 2 adds digest mode.

## Future plans

- **Daily / weekly digest mode** — instead of N emails, one summary email per day per recipient with all the day's notifications. Phase 2.
- **Localization beyond TR/EN** — DE/FR when EU expansion. The template registry already supports `messages/{locale}/notifications.json`.
- **Mobile push (APNS/FCM)** — when carrier driver mobile app lands (Phase 2).
- **In-app push toasts** — currently the bell shows; Phase 2 adds toast notifications for events while the user is active in the app.
- **SMS carrier-specific delivery reports** — Phase 2 abstraction.
- **A/B testing of email subjects** — Phase 2 marketing optimization.
- **Notification analytics** — open rate, click-through, conversion. Wired through PostHog (ADR-0020).
- **WhatsApp / Telegram channels** — Phase 3 if requested; the dispatcher's channel enum extends.
- **Smart notification timing** — ML model determines best send time per user. Phase 3.
- **External webhook delivery** — enterprise customers can configure a webhook URL to receive their org's notifications. Phase 2.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Single-channel email-only in P1 | UX regression on auction-won + escrow-disputed events; SMS is operationally needed. |
| Direct SES calls from Hono routes | Couples mutation to SES availability; loses retry/queue safety. |
| Push notifications without VAPID (e.g. OneSignal) | Third-party in trust chain; KVKK paperwork. Web Push native is free + EU-friendly. |
| Twilio for SMS | Per-message cost ~5x Turkish providers; foreign data transfer = KVKK SCC paperwork. |
| Dynamic templates in DB | Cute but premature — P1 has 25 templates; YAGNI on a DB-driven template engine. |
| Single SQS queue for all channels | Channel-specific retry policies (email retries 3x; SMS retries once) diverge; one queue per channel is cleaner. |

## Reference

- ADR-0006 — Outbox pattern (the event source)
- ADR-0019 — File storage (no large attachments in notifications, but link to S3 docs)
- ADR-0020 — Observability (alarm on notification delivery rate)
- ADR-0022 — Rate limiting (OTP send caps)
- ADR-0023 — Secrets management (VAPID keys, SES creds, SMS API keys)
- PRD-0007 — Operations (KVKK request flow uses notifications)
- PRD-0009 — Onboarding (uses welcome / verification notifications)
- AWS SES: https://docs.aws.amazon.com/ses/
- Web Push Protocol: https://web.dev/push-notifications-overview/
- Netgsm API: https://www.netgsm.com.tr/dokuman/
