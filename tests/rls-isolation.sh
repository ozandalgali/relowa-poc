#!/usr/bin/env bash
# tests/rls-isolation.sh
#
# Smoke test for the Plan B+ Realtime Hybrid substrate.
# Asserts that RLS policies enforce cross-tenant + intra-org-role isolation.
#
# Exit code 0 = all scenarios passed. Non-zero = at least one failure.
#
# Pre-requisites:
#   pnpm infra:up && pnpm db:migrate && pnpm db:seed
#
# This is the canonical regression test for the substrate. CI runs it.
# Failure should NEVER be addressed by relaxing assertions — fix the schema/policy.

set -euo pipefail

PSQL_HOST="${PSQL_HOST:-localhost}"
PSQL_PORT="${PSQL_PORT:-5433}"
PSQL_USER="${PSQL_USER:-relowa}"
PSQL_DB="${PSQL_DB:-relowa}"
PSQL_PASSWORD="${PSQL_PASSWORD:-dev_password_change_me}"

PSQL="env PGPASSWORD=$PSQL_PASSWORD psql -h $PSQL_HOST -p $PSQL_PORT -U $PSQL_USER -d $PSQL_DB -tA -q"

# Helper: run a query that should return a single integer count.
# Suppresses BEGIN/SET/COMMIT noise and JSON echoes; returns just the count.
count_query() {
  local sql="$1"
  $PSQL <<SQL 2>/dev/null | grep -E '^[0-9]+$' | head -1
$sql
SQL
}

# ─── helpers ──────────────────────────────────────────────────────────

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  echo "  ✓ $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "  ✗ $1"
  echo "    expected: $2"
  echo "    actual:   $3"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

assert_eq() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    pass "$label"
  else
    fail "$label" "$expected" "$actual"
  fi
}

# ─── ensure app_user role + grants exist ──────────────────────────────

$PSQL <<SQL >/dev/null
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user;
  END IF;
END
\$\$;
GRANT USAGE ON SCHEMA public, auth TO app_user;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;
SQL

# ─── pull current seed IDs ────────────────────────────────────────────

ACME_ADMIN_ID=$($PSQL -c "SELECT id FROM users WHERE email = 'ahmet@acme.example';")
ACME_ORG_ID=$($PSQL -c "SELECT id FROM organizations WHERE name = 'Acme Industrial Solutions';")
EKO_ADMIN_ID=$($PSQL -c "SELECT id FROM users WHERE email = 'mehmet@ekometal.example';")
EKO_ORG_ID=$($PSQL -c "SELECT id FROM organizations WHERE name = 'EkoMetal Geri Dönüşüm';")
HIZLI_ADMIN_ID=$($PSQL -c "SELECT id FROM users WHERE email = 'kadir@hizli.example';")
HIZLI_ORG_ID=$($PSQL -c "SELECT id FROM organizations WHERE name = 'Hızlı Lojistik';")

if [[ -z "$ACME_ADMIN_ID" || -z "$ACME_ORG_ID" ]]; then
  echo "✗ seed data missing — run 'pnpm db:seed' first"
  exit 1
fi

# ─── test cases ───────────────────────────────────────────────────────

echo ""
echo "Running RLS isolation tests against $PSQL_HOST:$PSQL_PORT/$PSQL_DB"
echo ""

# Test 1: Acme producer admin sees own 3 tenders (incl. draft)
RESULT=$(count_query "BEGIN;
SET LOCAL ROLE app_user;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '$ACME_ADMIN_ID', 'active_org_id', '$ACME_ORG_ID', 'email', 'ahmet@acme.example'
)::text, true);
SELECT count(*) FROM tenders;
COMMIT;")
assert_eq "TEST 1: Acme admin sees all 3 own-org tenders (incl. draft)" "3" "$RESULT"

# Test 2: EkoMetal recycler admin sees only published (2)
RESULT=$(count_query "BEGIN;
SET LOCAL ROLE app_user;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '$EKO_ADMIN_ID', 'active_org_id', '$EKO_ORG_ID', 'email', 'mehmet@ekometal.example'
)::text, true);
SELECT count(*) FROM tenders;
COMMIT;")
assert_eq "TEST 2: EkoMetal recycler admin sees only PUBLISHED tenders (2)" "2" "$RESULT"

# Test 3: Hızlı carrier sees 0 (no policy yet)
RESULT=$(count_query "BEGIN;
SET LOCAL ROLE app_user;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '$HIZLI_ADMIN_ID', 'active_org_id', '$HIZLI_ORG_ID', 'email', 'kadir@hizli.example'
)::text, true);
SELECT count(*) FROM tenders;
COMMIT;")
assert_eq "TEST 3: Hızlı carrier sees 0 tenders (no carrier policy yet)" "0" "$RESULT"

# Test 4: Anonymous (no JWT) sees 0
RESULT=$(count_query "BEGIN;
SET LOCAL ROLE app_user;
SELECT count(*) FROM tenders;
COMMIT;")
assert_eq "TEST 4: Anonymous user sees 0 tenders" "0" "$RESULT"

# Test 5: Cross-tenant INSERT must fail
INSERT_OUTCOME=$(
  $PSQL <<SQL 2>&1 || true
BEGIN;
SET LOCAL ROLE app_user;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '$ACME_ADMIN_ID', 'active_org_id', '$ACME_ORG_ID', 'email', 'ahmet@acme.example'
)::text, true);
INSERT INTO tenders (org_id, created_by_user_id, material_type, quantity_tons, pickup_region)
VALUES ('$EKO_ORG_ID', '$ACME_ADMIN_ID', 'metal_scrap', 5.0, 'Kocaeli');
ROLLBACK;
SQL
)
if echo "$INSERT_OUTCOME" | grep -qi "violates row-level security"; then
  pass "TEST 5: Cross-tenant INSERT denied by RLS"
else
  fail "TEST 5: Cross-tenant INSERT denied by RLS" "row-level security violation" "$INSERT_OUTCOME"
fi

# ─── summary ──────────────────────────────────────────────────────────

echo ""
echo "─────────────────────────────────────────"
echo "  Passed: $PASS_COUNT"
echo "  Failed: $FAIL_COUNT"
echo "─────────────────────────────────────────"

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo "✗ RLS isolation suite has failures"
  exit 1
fi

echo "✓ all 5 RLS scenarios passed"
echo "✓ substrate is sound — Plan B+ Realtime Hybrid stack validated"
