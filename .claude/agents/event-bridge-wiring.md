---
skill: event-bridge-wiring
purpose: Define EventBridge buses, rules, schedulers, and Lambda targets for the bidding loop and notification fan-out.
squad: api-workflow
required_reading:
  - AGENTS.md
  - docs/adr/0009-local-bidding-architecture.md
  - docs/adr/0006-outbox-pattern-for-appsync.md
  - docs/adr/0010-carrier-sub-auction.md
  - apps/api/src/middleware/events.ts
  - scripts/setup-events.sh (when it exists)
---

# Skill: event-bridge-wiring

## When to invoke

- Adding a new event type (e.g. `carrier_ad.awarded`).
- Adding a new scheduled rule (e.g. nightly anchor job per ADR-0008).
- Wiring a new Lambda target onto an existing rule.
- Migrating dev LocalStack rules to production AWS.
- Diagnosing a missed event in the bus.

**Do NOT invoke this skill for:** publishing logic inside Hono routes (that's `endpoint-writer` calling `publishEvent`). This skill owns the *infrastructure* — buses, rules, targets — not the publisher code.

## Required reading

- `AGENTS.md`
- `docs/adr/0009-local-bidding-architecture.md` — the canonical bidding loop
- `docs/adr/0006-outbox-pattern-for-appsync.md` — outbox vs direct event distinction
- `docs/adr/0010-carrier-sub-auction.md` — carrier-side events
- `apps/api/src/middleware/events.ts` — current publisher
- `scripts/setup-events.sh` — current LocalStack provisioning

## Inputs

- The new event's name (`<aggregate>.<verb>`), payload shape, and consumers.
- The target Lambda (or service) handling it.
- Whether the event needs retry / DLQ / FIFO semantics.

## Outputs

For a new event:

1. **Update `scripts/setup-events.sh`** with the new `put-rule` and `put-targets` commands.
2. **Document the event** in a section of ADR-0009 or a new ADR if the event reshapes the architecture.
3. **Add the publisher call** in the relevant Hono route (hand off to `endpoint-writer` if not already in place).
4. **Add a test** that the event materializes in the local bus (or that the outbox row exists, depending on ADR-0006 vs direct path).
5. **Production CDK/Terraform module** updates (hand off to `ci-cd-engineer`).

## Event categories

| Pattern | Use when | Mechanism |
|---|---|---|
| **Direct EventBridge** | Inter-service workflow (auction-close Lambda, escrow callback) | `apps/api/src/middleware/events.ts` → `PutEvents` |
| **Outbox → AppSync** | UI realtime push (live bids, shipment events) | `outbox` table → relay → AppSync (ADR-0006) |
| **Both** | Critical state changes (e.g. `tender.won`) | Direct event for backend Lambda; outbox row for UI push |

When choosing, ask: *who is the consumer?* Internal Lambda → direct. UI subscriber → outbox. Both → both.

## Non-negotiables

- ❌ **Never** publish an event without auditing it (`audit_events` row in the same transaction).
- ❌ **Never** rely on event order across different aggregate types — same-aggregate order is the only guarantee (ADR-0006 §8).
- ❌ **Never** make a Lambda target's logic idempotent-by-hope. Use the outbox `id` or the SQS message dedup ID.
- ❌ **Never** add a new scheduler rule shorter than 30s in production (rate cap, cost).
- ✅ **Always** name events `<aggregate>.<past_verb>` lowercase (e.g. `tender.published`, not `TenderPublishedEvent`).
- ✅ **Always** include `org_id` in event payload for fan-out scoping.
- ✅ **Always** define the JSON shape in TypeScript (`apps/api/src/events/types.ts`) and reuse from both publisher and consumer.

## Verification

```bash
# Provision LocalStack rules
./scripts/setup-events.sh

# Trigger the publisher
./tests/bidding-flow.sh   # or the specific event test

# Inspect bus
awslocal events list-rules --event-bus-name relowa-events
awslocal sqs receive-message --queue-url <target-queue>
```

## See also

- `.opencode/skills/endpoint-writer.md` — the publisher side
- `.opencode/skills/state-machine-author.md` — Step Functions consume EventBridge too
- `.opencode/skills/realtime-debugger.md` — when events are emitted but UI doesn't update
- `.opencode/skills/ci-cd-engineer.md` — production IaC for the same rules
