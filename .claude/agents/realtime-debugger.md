---
skill: realtime-debugger
purpose: Diagnose Supabase Realtime / Postgres logical replication / AppSync subscription / outbox relay problems end-to-end.
squad: frontend-ui
required_reading:
  - AGENTS.md
  - docs/adr/0002-supabase-realtime-standalone.md
  - docs/adr/0006-outbox-pattern-for-appsync.md
  - docker-compose.yml
  - docker/postgres/init.sql
  - docs/memory/learned/realtime-aes-key-length.md
---

# Skill: realtime-debugger

## When to invoke

- WebSocket subscriptions in the frontend not receiving updates.
- Realtime container in `Restarting` or `unhealthy` state.
- "Connection lost" symptoms after a Postgres restart.
- New table not appearing in subscription stream.

## Inputs

- `docker-compose.yml` Realtime service definition
- `docker/postgres/init.sql` — publication setup
- `packages/db/src/migrations/0001_rls_helpers_and_policies.sql` — `ALTER PUBLICATION` lines
- `docs/memory/learned/realtime-aes-key-length.md` — common gotcha

## Diagnostic checklist

### 1. Is the container running?

```bash
docker compose ps relowa-realtime
# expect: Up (healthy)
```

If `Restarting`, jump to logs:

```bash
docker compose logs realtime --tail=80
```

Look for:
- `:badarg "Bad key size"` → see [[../../docs/memory/learned/realtime-aes-key-length]]
- `connection refused to postgres:5432` → Postgres not yet healthy when Realtime started
- `Authentication failed` → wrong `DB_USER`/`DB_PASSWORD`/`DB_NAME` env vars

### 2. Is Postgres set up for logical replication?

```sql
SHOW wal_level;        -- expect: logical
SHOW max_replication_slots;
SHOW max_wal_senders;
```

If `wal_level` is anything other than `logical`, Realtime cannot work. Fix in `docker-compose.yml` Postgres command.

### 3. Does the publication exist and include the table?

```sql
SELECT pubname FROM pg_publication;
-- expect: supabase_realtime

SELECT pubname, schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
-- expect: rows for each table you want to track
```

To add a missing table:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE my_table;
```

### 4. Is the replication slot active?

```sql
SELECT slot_name, plugin, slot_type, active, restart_lsn FROM pg_replication_slots;
```

If `active` is `f` for the realtime slot, Realtime isn't connected. Restart the container:

```bash
docker compose restart realtime
```

### 5. Is the client connecting?

In the frontend:

```typescript
import { RealtimeClient } from '@supabase/realtime-js';
const client = new RealtimeClient(REALTIME_URL, { params: { apikey: ANON_KEY } });
client.connect();
client.onOpen(() => console.log('connected'));
client.onError((e) => console.error('error', e));
```

Watch the browser console. Common issues:

- `403 Forbidden` from health endpoint → wrong tenant token
- WebSocket immediately closes → wrong `REALTIME_URL` (should be `ws://...` or `wss://...` with `/socket` path)
- Subscribed but no events → table not in publication, or RLS blocking the user

### 6. Is RLS letting the user see the change?

Realtime respects RLS. A user who couldn't `SELECT` a row also won't receive its change events. Confirm by running the equivalent SELECT in `psql` with the user's JWT claims.

## Non-negotiables

- ❌ **Never** disable RLS on a realtime-published table to "make subscriptions work." Users must see only what they're authorized to see, even via realtime.
- ❌ **Never** put PII in payload columns of public-realtime tables. The CDC stream is authorized but is observable.
- ✅ **Always** add new tables to the publication explicitly. Migrations should include `ALTER PUBLICATION supabase_realtime ADD TABLE ...` if realtime is needed.
- ✅ **Always** test subscriptions after schema changes — `pnpm db:reset` may invalidate the slot's resume position.

## See also

- `docs/adr/0002-supabase-realtime-standalone.md`
- `docs/memory/learned/realtime-aes-key-length.md`
