---
skill: endpoint-writer
purpose: Write Hono API endpoints with proper auth context, idempotency, validation, audit, and outbox publishing.
squad: api-workflow
required_reading:
  - AGENTS.md
  - apps/api/src/middleware/auth.ts
  - apps/api/src/middleware/idempotency.ts
  - apps/api/src/middleware/events.ts
  - packages/db/src/schema.ts
  - docs/adr/0003-rls-with-jwt-guc-pattern.md
  - docs/adr/0009-local-bidding-architecture.md
  - docs/adr/0006-outbox-pattern-for-appsync.md
  - docs/memory/concepts/auth-uid-pattern.md
  - docs/memory/concepts/idempotency.md
  - docs/memory/concepts/server-authoritative-state.md
---

# Skill: endpoint-writer

## When to invoke

- Adding a new Hono route or modifying an existing one.
- Adding HTTP-level business logic.

## Inputs

- `apps/api/src/middleware/rls-context.ts` — the JWT-to-GUC bridge
- `apps/api/src/middleware/idempotency.ts` — the idempotency layer
- `packages/db/src/schema.ts` — Drizzle schema for type-safe queries
- `docs/memory/concepts/auth-uid-pattern.md` — RLS context flow
- `docs/memory/concepts/idempotency.md` — idempotency contract

## Endpoint anatomy

Every authenticated mutation endpoint follows this shape:

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { rlsContext } from './middleware/rls-context';
import { idempotency } from './middleware/idempotency';
import { db, tenders, auditEvents } from '@relowa/db';

const CreateTenderInput = z.object({
  materialType: z.enum(['metal_scrap', 'plastic', 'paper', 'electronic', 'chemical', 'other']),
  quantityTons: z.number().positive(),
  pickupRegion: z.string().min(1),
  pickupAddress: z.string().optional(),
  notes: z.string().optional(),
});

export const tendersRoute = new Hono()
  .use(rlsContext)
  .use(idempotency)
  .post('/', zValidator('json', CreateTenderInput), async (c) => {
    const input = c.req.valid('json');
    const userId = c.get('userId');
    const orgId = c.get('orgId');

    const result = await db.transaction(async (tx) => {
      const [tender] = await tx.insert(tenders).values({
        orgId,
        createdByUserId: userId,
        ...input,
        status: 'draft',
      }).returning();

      await tx.insert(auditEvents).values({
        orgId,
        userId,
        action: 'tender.created',
        entityType: 'tender',
        entityId: tender.id,
        payload: input,
      });

      return tender;
    });

    return c.json(result, 201);
  });
```

## Required pieces of every authenticated endpoint

1. **`rlsContext` middleware** — sets JWT claims into Postgres GUC.
2. **`idempotency` middleware** for mutations — replays first response on duplicate keys.
3. **`zValidator` on input** — never trust client payload structure.
4. **`db.transaction(...)`** for any multi-statement mutation — guarantees atomicity.
5. **`auditEvents` insert** for any state change — the audit trail.
6. **No application-layer authorization checks.** RLS handles tenant + role isolation. If RLS would let a wrong user through, **fix the policy, not the endpoint**.

## Patterns

### Read endpoint

```typescript
.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tender = await db.query.tenders.findFirst({
    where: (t, { eq }) => eq(t.id, id),
  });
  if (!tender) return c.json({ error: 'not_found' }, 404);
  return c.json(tender);
});
```

If RLS hides the row, `findFirst` returns undefined → 404. **Don't** also check `tender.orgId === orgId` — that's redundant and indicates distrust of the policy.

### Mutation with state transition

For state transitions (publish, close, fund), use `WHERE status = 'expected_current'` to make transitions idempotent at the SQL level:

```typescript
const [updated] = await db.update(tenders)
  .set({ status: 'published', publishedAt: new Date() })
  .where(and(eq(tenders.id, id), eq(tenders.status, 'draft')))
  .returning();

if (!updated) {
  return c.json({ error: 'invalid_state_transition' }, 409);
}
```

## Non-negotiables

- ❌ **Never** check `if (user.orgId !== row.orgId) throw` — that belongs in RLS.
- ❌ **Never** start a transaction without ending it.
- ❌ **Never** insert audit events outside the same transaction as the action they audit.
- ❌ **Never** skip `zValidator` because "the frontend already validates."
- ❌ **Never** mutate state on time-of-day basis from the request handler — schedule it server-side.
- ✅ **Always** return precise HTTP status codes: 201 on create, 200 on update, 204 on no-content delete, 409 on state conflict, 404 on not-found.
- ✅ **Always** include `Idempotency-Key` support on every POST/PUT/PATCH.
- ✅ **Always** record audit events in the same transaction.

## Verification

- Type check: `pnpm --filter @relowa/api typecheck`
- Tests: `pnpm --filter @relowa/api test`
- Run the RLS suite: `./tests/rls-isolation.sh` — must still pass.

## See also

- `docs/memory/concepts/idempotency.md`
- `docs/memory/concepts/server-authoritative-state.md`
- `docs/runbook/rls-debugging.md`
