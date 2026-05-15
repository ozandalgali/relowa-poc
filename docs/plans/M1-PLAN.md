# M1 Plan — Auth, Data & RLS Substrate

> **Agent:** migration-author, rls-test-runner, ci-cd-engineer, doc-keeper
> **Lead:** lead-orchestrator (approved 2026-05-15)
> **Target:** Weeks 4-6 per PRD-0003

## Status

| Step | Status |
|------|--------|
| 1. Schema additions (14 tables, 6 enums) | 🔨 In progress |
| 2. Drizzle generate + raw SQL RLS side-car | ⬜ Pending |
| 3. relowa_admin DB role (raw SQL) | ⬜ Pending |
| 4. Register raw SQL in migrate.ts | ⬜ Pending |
| 5. Extend RLS isolation tests | ⬜ Pending |
| 6. Terraform: enable RDS backups | ⬜ Pending |
| 7. db:reset + verify locally | ⬜ Pending |
| 8. CHANGELOG + docs | ⬜ Pending |

## Dependency graph

```
[migration-author] → [Drizzle generate]
                    ↓
              [raw SQL side-car] + [relowa_admin role]
                    ↓
              [migrate.ts RAW_SQL_FILES]
                    ↓
              [rls-test-runner] ←→ [ci-cd-engineer: RDS backups]
                    ↓
              [db:reset + rls-isolation.sh]
                    ↓
              [doc-keeper]
```

## Step 1 — Schema additions

### New enums (6)
- `staff_role`: super_admin, account_manager, support_agent, compliance_officer, financial_analyst
- `risk_level`: low, medium, high, critical  
- `carrier_ad_status`: open, closing, awarded, cancelled, expired
- `carrier_bid_status`: submitted, withdrawn, rejected, accepted
- `shipment_status`: pending, in_transit, delivered, disputed, completed
- `escrow_status`: pending, funds_locked, in_transit, delivered, released, refunded, disputed, failed

### New tables (14)
- Staff RBAC: `internal_staff`, `staff_org_assignments`, `staff_permissions`, `staff_role_permissions`, `admin_audit_log`
- Carrier: `carrier_ads`, `carrier_bids`, `shipments`, `shipment_events`
- Escrow: `escrow_orders`, `escrow_transactions`, `provider_webhooks`
- Outbox: `outbox`
- Anchor: `anchor_log`

## Manual steps (1)

| # | When | Action |
|---|------|--------|
| 1 | After step 6 (ci-cd-engineer) | `terraform apply` in `infra/` to enable RDS backups |
