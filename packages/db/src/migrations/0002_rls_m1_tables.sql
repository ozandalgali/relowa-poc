-- ─── M1 RLS policies + roles + seed ───────────────────────────────
-- Side-car migration for the 14 new tables added in M1.
-- Run AFTER Drizzle migration 0001_sad_wendell_rand.sql.
--
-- Pattern: ENABLE RLS → policy per cmd (SELECT, INSERT, UPDATE) → publication

-- ─── Role creation (idempotent) ────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public, auth TO app_user;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;

-- ─── relowa_admin DB role ──────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'relowa_admin') THEN
    CREATE ROLE relowa_admin WITH LOGIN BYPASSRLS PASSWORD 'dev_admin_password_change_me';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public, auth TO relowa_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO relowa_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO relowa_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO relowa_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO relowa_admin;

-- Restrict app_user from staff tables
REVOKE ALL ON internal_staff, staff_org_assignments, staff_permissions, staff_role_permissions, admin_audit_log FROM app_user;

-- ─── Enable RLS on all new tables ──────────────────────────────────

ALTER TABLE internal_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_org_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE carrier_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE escrow_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_webhooks ENABLE ROW LEVEL SECURITY;

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;

ALTER TABLE anchor_log ENABLE ROW LEVEL SECURITY;

-- ─── Staff tables — no app_user access (revoked above) ─────────────

-- Staff tables use relowa_admin only. No policies for app_user.
-- relowa_admin has BYPASSRLS, so it bypasses all policies.

-- ─── carrier_ads RLS ───────────────────────────────────────────────

-- Recycler: read + write own ads
DROP POLICY IF EXISTS carrier_ads_select_recycler ON carrier_ads;
CREATE POLICY carrier_ads_select_recycler ON carrier_ads
  FOR SELECT
  TO app_user
  USING (auth.org_id() = recycler_org_id);

DROP POLICY IF EXISTS carrier_ads_insert_recycler ON carrier_ads;
CREATE POLICY carrier_ads_insert_recycler ON carrier_ads
  FOR INSERT
  TO app_user
  WITH CHECK (
    auth.org_id() = recycler_org_id
    AND auth.has_role('admin')
  );

DROP POLICY IF EXISTS carrier_ads_update_recycler ON carrier_ads;
CREATE POLICY carrier_ads_update_recycler ON carrier_ads
  FOR UPDATE
  TO app_user
  USING (auth.org_id() = recycler_org_id)
  WITH CHECK (auth.org_id() = recycler_org_id);

-- Producer: read own tender's carrier ads
DROP POLICY IF EXISTS carrier_ads_select_producer ON carrier_ads;
CREATE POLICY carrier_ads_select_producer ON carrier_ads
  FOR SELECT
  TO app_user
  USING (
    EXISTS (
      SELECT 1 FROM tenders t
      WHERE t.id = carrier_ads.tender_id
      AND t.org_id = auth.org_id()
    )
  );

-- Carrier: read open ads (marketplace feed)
DROP POLICY IF EXISTS carrier_ads_select_carrier ON carrier_ads;
CREATE POLICY carrier_ads_select_carrier ON carrier_ads
  FOR SELECT
  TO app_user
  USING (status = 'open');

-- ─── carrier_bids RLS ──────────────────────────────────────────────

-- Recycler: read bids on own ads
DROP POLICY IF EXISTS carrier_bids_select_recycler ON carrier_bids;
CREATE POLICY carrier_bids_select_recycler ON carrier_bids
  FOR SELECT
  TO app_user
  USING (
    EXISTS (
      SELECT 1 FROM carrier_ads ca
      WHERE ca.id = carrier_bids.carrier_ad_id
      AND ca.recycler_org_id = auth.org_id()
    )
  );

-- Carrier: read + write own bids
DROP POLICY IF EXISTS carrier_bids_select_carrier ON carrier_bids;
CREATE POLICY carrier_bids_select_carrier ON carrier_bids
  FOR SELECT
  TO app_user
  USING (auth.org_id() = carrier_org_id);

DROP POLICY IF EXISTS carrier_bids_insert_carrier ON carrier_bids;
CREATE POLICY carrier_bids_insert_carrier ON carrier_bids
  FOR INSERT
  TO app_user
  WITH CHECK (
    auth.org_id() = carrier_org_id
    AND auth.has_role('admin')
    AND EXISTS (
      SELECT 1 FROM carrier_ads ca
      WHERE ca.id = carrier_bids.carrier_ad_id
      AND ca.status = 'open'
    )
  );

DROP POLICY IF EXISTS carrier_bids_update_carrier ON carrier_bids;
CREATE POLICY carrier_bids_update_carrier ON carrier_bids
  FOR UPDATE
  TO app_user
  USING (auth.org_id() = carrier_org_id)
  WITH CHECK (auth.org_id() = carrier_org_id);

-- ─── shipments RLS ─────────────────────────────────────────────────

-- All involved parties can read their shipments
DROP POLICY IF EXISTS shipments_select_involved ON shipments;
CREATE POLICY shipments_select_involved ON shipments
  FOR SELECT
  TO app_user
  USING (
    auth.org_id() IN (carrier_org_id, recycler_org_id, producer_org_id)
  );

-- Recycler: insert when awarding
DROP POLICY IF EXISTS shipments_insert_recycler ON shipments;
CREATE POLICY shipments_insert_recycler ON shipments
  FOR INSERT
  TO app_user
  WITH CHECK (auth.org_id() = recycler_org_id);

-- Carrier: update status (pickup, transit, delivered)
DROP POLICY IF EXISTS shipments_update_carrier ON shipments;
CREATE POLICY shipments_update_carrier ON shipments
  FOR UPDATE
  TO app_user
  USING (auth.org_id() = carrier_org_id)
  WITH CHECK (auth.org_id() = carrier_org_id);

-- ─── shipment_events RLS ───────────────────────────────────────────

DROP POLICY IF EXISTS shipment_events_select_involved ON shipment_events;
CREATE POLICY shipment_events_select_involved ON shipment_events
  FOR SELECT
  TO app_user
  USING (
    EXISTS (
      SELECT 1 FROM shipments s
      WHERE s.id = shipment_events.shipment_id
      AND auth.org_id() IN (s.carrier_org_id, s.recycler_org_id, s.producer_org_id)
    )
  );

DROP POLICY IF EXISTS shipment_events_insert_carrier ON shipment_events;
CREATE POLICY shipment_events_insert_carrier ON shipment_events
  FOR INSERT
  TO app_user
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM shipments s
      WHERE s.id = shipment_events.shipment_id
      AND auth.org_id() = s.carrier_org_id
    )
  );

-- ─── escrow_orders RLS ─────────────────────────────────────────────

DROP POLICY IF EXISTS escrow_orders_select_involved ON escrow_orders;
CREATE POLICY escrow_orders_select_involved ON escrow_orders
  FOR SELECT
  TO app_user
  USING (
    auth.org_id() IN (buyer_org_id, seller_org_id, carrier_org_id)
  );

DROP POLICY IF EXISTS escrow_orders_insert_buyer ON escrow_orders;
CREATE POLICY escrow_orders_insert_buyer ON escrow_orders
  FOR INSERT
  TO app_user
  WITH CHECK (auth.org_id() = buyer_org_id);

-- ─── escrow_transactions RLS ───────────────────────────────────────

DROP POLICY IF EXISTS escrow_transactions_select_involved ON escrow_transactions;
CREATE POLICY escrow_transactions_select_involved ON escrow_transactions
  FOR SELECT
  TO app_user
  USING (
    EXISTS (
      SELECT 1 FROM escrow_orders eo
      WHERE eo.id = escrow_transactions.escrow_order_id
      AND auth.org_id() IN (eo.buyer_org_id, eo.seller_org_id, eo.carrier_org_id)
    )
  );

-- ─── provider_webhooks — no app_user access (system-internal) ──────

-- ─── outbox — system-internal, no app_user SELECT ──────────────────

-- Outbox INSERT: any authenticated user can insert (written inside mutation tx)
DROP POLICY IF EXISTS outbox_insert_app_user ON outbox;
CREATE POLICY outbox_insert_app_user ON outbox
  FOR INSERT
  TO app_user
  WITH CHECK (true);

-- Outbox SELECT: no app_user access (outbox is a relay table, not user-facing)

-- ─── anchor_log — system-internal, no app_user access ──────────────

-- ─── admin_audit_log hash chain trigger ────────────────────────────

CREATE OR REPLACE FUNCTION compute_admin_audit_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prev text;
BEGIN
  SELECT hash INTO prev FROM admin_audit_log
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

  NEW.prev_hash := prev;
  NEW.hash := encode(
    digest(
      COALESCE(NEW.id::text, '') || ':' ||
      COALESCE(NEW.staff_id::text, '') || ':' ||
      COALESCE(NEW.action, '') || ':' ||
      COALESCE(NEW.reason, '') || ':' ||
      COALESCE(NEW.client_ip, '') || ':' ||
      COALESCE(prev, 'genesis'),
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_audit_hash ON admin_audit_log;
CREATE TRIGGER trg_admin_audit_hash
  BEFORE INSERT ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION compute_admin_audit_hash();

-- ─── updated_at triggers for new tables ────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_carrier_ads_updated_at ON carrier_ads;
CREATE TRIGGER trg_carrier_ads_updated_at
  BEFORE UPDATE ON carrier_ads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_carrier_bids_updated_at ON carrier_bids;
CREATE TRIGGER trg_carrier_bids_updated_at
  BEFORE UPDATE ON carrier_bids
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_shipments_updated_at ON shipments;
CREATE TRIGGER trg_shipments_updated_at
  BEFORE UPDATE ON shipments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Realtime publication — add new tables ─────────────────────────

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE carrier_ads; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE carrier_bids; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE shipments; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE shipment_events; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Seed: staff_permissions catalog ───────────────────────────────

INSERT INTO staff_permissions (code, description, risk) VALUES
  ('org:read', 'View organization profile and aggregate data', 'low'),
  ('org:write', 'Edit organization profile on behalf of operator', 'medium'),
  ('org:impersonate', 'Issue a temporary JWT to act as an operator user', 'high'),
  ('tender:force_close', 'Manually close a stuck auction', 'high'),
  ('tender:read_all', 'Search/list tenders across orgs', 'low'),
  ('bid:read_all', 'View bids across orgs (sensitive — pricing data)', 'low'),
  ('escrow:read_all', 'View escrow state across orgs', 'medium'),
  ('escrow:manual_release', 'Release/refund escrow outside the state machine', 'critical'),
  ('audit:read_all', 'Read user audit_events across orgs', 'medium'),
  ('compliance:export', 'Export KVKK/CSRD reports across orgs', 'medium'),
  ('finance:read_all', 'View invoices, payment history across orgs', 'medium'),
  ('ticket:read_assigned', 'View support tickets in assigned orgs', 'low'),
  ('ticket:read_all', 'View support tickets across orgs', 'low'),
  ('ticket:write', 'Reply to / close support tickets', 'low'),
  ('staff:read', 'View other staff members', 'low'),
  ('staff:manage', 'Create/disable staff, change roles, assign orgs', 'critical'),
  ('admin_audit:read', 'Read admin_audit_log', 'medium')
ON CONFLICT (code) DO NOTHING;

-- ─── Seed: staff_role_permissions mapping ──────────────────────────

-- super_admin gets ALL permissions
INSERT INTO staff_role_permissions (role, permission_code)
SELECT 'super_admin', code FROM staff_permissions
ON CONFLICT (role, permission_code) DO NOTHING;

-- account_manager
INSERT INTO staff_role_permissions (role, permission_code) VALUES
  ('account_manager', 'org:read'),
  ('account_manager', 'org:write'),
  ('account_manager', 'org:impersonate'),
  ('account_manager', 'tender:read_all'),
  ('account_manager', 'bid:read_all'),
  ('account_manager', 'escrow:read_all'),
  ('account_manager', 'ticket:read_assigned'),
  ('account_manager', 'ticket:write')
ON CONFLICT (role, permission_code) DO NOTHING;

-- support_agent
INSERT INTO staff_role_permissions (role, permission_code) VALUES
  ('support_agent', 'org:read'),
  ('support_agent', 'tender:read_all'),
  ('support_agent', 'ticket:read_assigned'),
  ('support_agent', 'ticket:write')
ON CONFLICT (role, permission_code) DO NOTHING;

-- compliance_officer
INSERT INTO staff_role_permissions (role, permission_code) VALUES
  ('compliance_officer', 'org:read'),
  ('compliance_officer', 'audit:read_all'),
  ('compliance_officer', 'compliance:export'),
  ('compliance_officer', 'admin_audit:read')
ON CONFLICT (role, permission_code) DO NOTHING;

-- financial_analyst
INSERT INTO staff_role_permissions (role, permission_code) VALUES
  ('financial_analyst', 'org:read'),
  ('financial_analyst', 'escrow:read_all'),
  ('financial_analyst', 'finance:read_all')
ON CONFLICT (role, permission_code) DO NOTHING;
