# Test category — State Machine

**Status:** 📋 P1, to build.
**Owner:** `tester`.
**Runner:** Vitest + Step Functions Local + Postgres.
**Location:** `tests/state-machine/`.

## Purpose

Verify the escrow state machine (ADR-0007) and any future workflows. State machines orchestrate multi-day, multi-actor flows with retries and external callbacks — bugs are catastrophic and only visible at scale unless explicitly tested.

## Pipeline tested

```
StartExecution
  → Task Lambda (mocked or real with ManualProvider)
  → State transition in DB
  → audit_events + escrow_transactions write
  → Next state
  → ... (with waits, callbacks, branches)
  → MarkReleased / MarkRefunded / MarkFailed
```

## Test shape

Each test exercises one path through the state machine.

```ts
import { describe, it, expect } from 'vitest';
import { sfnLocal } from '../helpers/sfn-local';
import { createEscrowOrder } from '../factories/escrow';

describe('escrow state machine', () => {
  it('happy path — funds locked → in transit → delivered → released', async () => {
    const order = await createEscrowOrder({ provider: 'manual' });

    const execution = await sfnLocal.start('EscrowFlow', { orderId: order.id });
    await sfnLocal.sendTaskSuccess(execution, { event: 'funded' });
    await sfnLocal.sendTaskSuccess(execution, { event: 'in_transit' });
    await sfnLocal.sendTaskSuccess(execution, { event: 'delivered' });
    await sfnLocal.advanceWait(execution, 'DisputeWindow');   // skip the 72h wait
    await sfnLocal.waitForCompletion(execution);

    const finalOrder = await db.query.escrowOrders.findFirst({ where: ... });
    expect(finalOrder?.status).toBe('released');

    // both disbursements happened
    const txs = await db.query.escrowTransactions.findMany({ where: ... });
    expect(txs.map(t => t.txType)).toContain('release_to_producer');
    expect(txs.map(t => t.txType)).toContain('release_to_carrier');
  });

  it('dispute path — opens manual review, super_admin resolves to refund', async () => { ... });

  it('timeout in WaitForFunding → MarkFailed', async () => { ... });

  it('Lambda task retry succeeds on second attempt', async () => { ... });

  it('webhook idempotency: same provider_event_id processed twice → second is no-op', async () => { ... });

  it('manual override is the only path to bypass DisputeWindow', async () => { ... });
});
```

## Coverage requirement

`apps/lambdas/escrow-tasks/**` has a coverage gate of 100% line + 95% branch (ADR-0017 §4). The state-machine integration tests are the primary driver. Unit tests on individual tasks complement.

## Step Functions Local quirks

- `waitForCallback` works but `SendTaskHeartbeat` has gaps; mitigate by mocking.
- Time-based waits are advanced via `sfnLocal.advanceWait()` helper, which sets the relevant timer.
- Local SFN doesn't enforce all IAM policies; tests should still assert on Lambda invocations as if IAM were enforced.

## What this category does NOT cover

- Real Iyzico / PayTR webhooks — those have their own contract tests against sandboxes (Phase 2).
- The UI surface for dispute resolution — that's E2E.

## Non-negotiables

- ❌ Never test by skipping wait states without using the helper. The helper records that the wait was intentional.
- ❌ Never let a test mutate `escrow_orders` outside the state machine. Tests should always go through `StartExecution`.
- ❌ Never test only happy paths. Every error branch needs at least one assertion.
- ✅ Always assert audit events + escrow_transactions match the state transition.
- ✅ Always test the manual-override path explicitly.

## See also

- ADR-0007 — Step Functions escrow
- `.opencode/skills/state-machine-author.md`
- `.opencode/skills/compliance-specialist.md` — money flows always trigger compliance
