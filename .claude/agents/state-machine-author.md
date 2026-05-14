---
skill: state-machine-author
purpose: Author Step Functions ASL workflows, especially the escrow state machine. Manage callbacks, retries, and manual-override surfaces.
squad: api-workflow
required_reading:
  - AGENTS.md
  - docs/adr/0007-step-functions-escrow.md
  - docs/adr/0014-internal-staff-rbac.md
  - docs/memory/concepts/idempotency.md
  - docs/memory/concepts/server-authoritative-state.md
---

# Skill: state-machine-author

## When to invoke

- Adding a new state to the escrow state machine (ADR-0007).
- Wiring a new provider adapter (PayTR fallback per PRD-0002).
- Authoring a new state machine for a separate workflow (e.g. KVKK data deletion request flow).
- Diagnosing a stuck execution.
- Implementing the manual-override callback path used by `super_admin`.

**Do NOT invoke this skill for:** in-transaction workflows that don't span multiple days/hours/external callbacks (those are Hono route logic). Use Step Functions when:
- The workflow can wait for hours/days for a callback.
- Multiple branches with retries and timeouts.
- Manual intervention is a defined state.

## Required reading

- `AGENTS.md`
- `docs/adr/0007-step-functions-escrow.md` — the canonical escrow state machine
- `docs/adr/0014-internal-staff-rbac.md` — the super_admin override path
- `docs/memory/concepts/idempotency.md` — every Lambda task must be idempotent
- `docs/memory/concepts/server-authoritative-state.md`

## Inputs

- The workflow shape (states, transitions, retry policies, timeouts).
- The Lambda tasks (small, single-responsibility, idempotent).
- The callback tokens (where `SendTaskSuccess` / `SendTaskFailure` come from).

## Outputs

For a new state machine:

1. **ASL definition** in `apps/state-machines/<name>/state-machine.json` (or `.asl.yaml`).
2. **Task Lambdas** in `apps/lambdas/<name>-tasks/` — one per task, each idempotent.
3. **CDK / Terraform module** (hand off to `ci-cd-engineer`).
4. **Integration test** using Step Functions Local that exercises the happy path + one error branch + the manual override.
5. **Runbook** in `docs/runbook/<workflow>-operations.md` describing how to investigate a stuck execution.

For an extension (new state, new branch):

1. ASL diff.
2. New / updated task Lambda.
3. Updated integration test.
4. ADR amendment if the state machine's contract changed.

## Task Lambda shape (every task)

```ts
export async function handler(event: TaskEvent): Promise<TaskResult> {
  // 1. Load the aggregate from DB
  const order = await db.escrowOrders.findById(event.orderId);

  // 2. Idempotency: if the desired post-state is already reached, return success
  if (order.status === event.targetStatus) return { ok: true, alreadyDone: true };

  // 3. Validate transition is allowed from current state
  if (!canTransition(order.status, event.targetStatus)) {
    throw new InvalidTransition(`${order.status} → ${event.targetStatus}`);
  }

  // 4. Call the provider (with provider's idempotency key = our task token)
  const result = await provider.releaseToSeller({
    providerOrderId: order.providerOrderId,
    amount: order.wasteAmount,
    idempotencyKey: event.taskToken,
  });

  // 5. Update DB + audit in one transaction
  await db.transaction(async (tx) => {
    await tx.update(escrowOrders).set({ status: event.targetStatus }).where(...);
    await tx.insert(escrowTransactions).values({...});
    await tx.insert(auditEvents).values({...});
  });

  return { ok: true, providerTxId: result.providerTxId };
}
```

## Non-negotiables

- ❌ **Never** make a task non-idempotent. Retries must be safe.
- ❌ **Never** mutate state outside a DB transaction.
- ❌ **Never** call the provider before checking task-token idempotency.
- ❌ **Never** add manual-override paths that bypass the state machine — they provide *input* to a waiting state, not a state transition.
- ❌ **Never** rely on Step Functions' own retry policy for things that need different-than-default behavior — codify retries in the ASL explicitly.
- ✅ **Always** include `audit_events` writes in the same transaction as the state update.
- ✅ **Always** define `Catch` blocks; uncaught errors mean the execution fails silently.
- ✅ **Always** test the `ManualReview` branch with a simulated super_admin callback.

## Verification

```bash
# Local SFN
docker compose up -d sfn-local

# Run an execution
aws stepfunctions start-execution \
  --endpoint http://localhost:8083 \
  --state-machine-arn arn:aws:states:us-east-1:123456789012:stateMachine:EscrowFlow \
  --input file://tests/fixtures/escrow-happy-path.json

# Inspect execution history
aws stepfunctions get-execution-history --endpoint http://localhost:8083 --execution-arn <arn>

# Run integration test
./tests/escrow-flow.sh
```

## See also

- `docs/adr/0007-step-functions-escrow.md`
- `.opencode/skills/event-bridge-wiring.md` — webhooks that resume executions
- `.opencode/skills/endpoint-writer.md` — the API surface that starts executions
- `.opencode/skills/compliance-specialist.md` — money flow always triggers compliance review
