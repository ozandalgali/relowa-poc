-- =============================================================
-- Relowa POC — RLS helpers + policies
-- =============================================================
-- This migration creates the auth.* helper functions that read
-- claims from the per-request JWT (set via PostgreSQL session
-- GUC: 'request.jwt.claims'). The Hono backend writes JWT
-- claims into this GUC at the start of every request.
--
-- Result: identical developer experience to Supabase's auth.uid().
-- We just don't get the magic — we wire it ourselves, ~30 lines.
-- =============================================================

CREATE SCHEMA IF NOT EXISTS auth;

-- ----- Helper functions ------------------------------------

-- Mirrors Supabase auth.uid()
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT (NULLIF(
    current_setting('request.jwt.claims', true),
    ''
  )::json->>'sub')::uuid;
$$;

-- Active organization id from JWT
CREATE OR REPLACE FUNCTION auth.org_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT (NULLIF(
    current_setting('request.jwt.claims', true),
    ''
  )::json->>'active_org_id')::uuid;
$$;

-- Email convenience
CREATE OR REPLACE FUNCTION auth.email() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true),
    ''
  )::json->>'email';
$$;

-- Role check inside the active org.
-- SECURITY DEFINER: helper bypasses RLS on org_members so policies
-- on org_members itself can call this without infinite recursion.
-- Explicit search_path prevents search_path injection attacks.
CREATE OR REPLACE FUNCTION auth.has_role(role_name text) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM org_members
    WHERE user_id = auth.uid()
      AND org_id = auth.org_id()
      AND role::text = role_name
      AND accepted_at IS NOT NULL
  );
$$;

-- Convenience: is this user a member of the active org at all?
CREATE OR REPLACE FUNCTION auth.is_member() RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM org_members
    WHERE user_id = auth.uid()
      AND org_id = auth.org_id()
      AND accepted_at IS NOT NULL
  );
$$;

-- Returns ALL orgs the user is a member of (across all orgs).
-- Used in SELECT policies where we need "is this row's org one of mine"
-- without re-triggering RLS recursion on org_members.
CREATE OR REPLACE FUNCTION auth.user_org_ids() RETURNS uuid[]
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(org_id), ARRAY[]::uuid[])
  FROM org_members
  WHERE user_id = auth.uid() AND accepted_at IS NOT NULL;
$$;

-- ----- Enable RLS on all app tables ------------------------

ALTER TABLE organizations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids             ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- ----- Policies: organizations ----------------------------
-- A user can SELECT their own orgs (any membership).
-- Org metadata is editable by admins only.

CREATE POLICY orgs_select_own_member ON organizations
  FOR SELECT
  USING (id = ANY(auth.user_org_ids()));

-- Phase 2: Recyclers see producer orgs of tenders they can bid on.
-- Implemented via a denormalized join in the API layer to avoid
-- cross-policy recursion (organizations <-> tenders).

CREATE POLICY orgs_update_admin ON organizations
  FOR UPDATE
  USING (id = auth.org_id() AND auth.has_role('admin'))
  WITH CHECK (id = auth.org_id() AND auth.has_role('admin'));

-- ----- Policies: org_members ------------------------------
-- A user sees memberships of their own orgs.
-- Only admins can manage members of their org.

CREATE POLICY members_select_same_org ON org_members
  FOR SELECT
  USING (org_id = ANY(auth.user_org_ids()));

CREATE POLICY members_insert_admin ON org_members
  FOR INSERT
  WITH CHECK (org_id = auth.org_id() AND auth.has_role('admin'));

CREATE POLICY members_update_admin ON org_members
  FOR UPDATE
  USING (org_id = auth.org_id() AND auth.has_role('admin'))
  WITH CHECK (org_id = auth.org_id() AND auth.has_role('admin'));

CREATE POLICY members_delete_admin ON org_members
  FOR DELETE
  USING (org_id = auth.org_id() AND auth.has_role('admin'));

-- ----- Policies: users ------------------------------------
-- A user always sees their own row.
-- A user can also see basic info of users in their orgs.

CREATE POLICY users_select_self ON users
  FOR SELECT
  USING (id = auth.uid());

CREATE POLICY users_select_same_org ON users
  FOR SELECT
  USING (
    id IN (
      SELECT user_id FROM org_members
      WHERE org_id = ANY(auth.user_org_ids())
    )
  );

CREATE POLICY users_update_self ON users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ----- Policies: tenders ----------------------------------
-- Producers see and write their own tenders.
-- Recyclers see all PUBLISHED + active tenders (for bidding).
-- Carriers (Phase 2) see only tenders where they are assigned (no policy yet).

CREATE POLICY tenders_select_own_org ON tenders
  FOR SELECT
  USING (org_id = auth.org_id());

CREATE POLICY tenders_select_published_for_recyclers ON tenders
  FOR SELECT
  USING (
    status IN ('published', 'closing')
    AND EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = auth.org_id() AND o.type = 'recycler'
    )
  );

CREATE POLICY tenders_insert_admin_or_ops ON tenders
  FOR INSERT
  WITH CHECK (
    org_id = auth.org_id()
    AND (auth.has_role('admin') OR auth.has_role('operations'))
    AND EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = auth.org_id() AND o.type = 'producer'
    )
  );

CREATE POLICY tenders_update_admin_or_ops ON tenders
  FOR UPDATE
  USING (
    org_id = auth.org_id()
    AND (auth.has_role('admin') OR auth.has_role('operations'))
  )
  WITH CHECK (
    org_id = auth.org_id()
    AND (auth.has_role('admin') OR auth.has_role('operations'))
  );

-- IMPORTANT: no DELETE policy on tenders.
-- Tenders are never deleted; they are CANCELLED via status.
-- Audit immutability is preserved.

-- ----- Policies: bids -------------------------------------
-- A bidder org sees its own bids.
-- The tender owner sees all bids on their tender.

CREATE POLICY bids_select_own_org ON bids
  FOR SELECT
  USING (bidder_org_id = auth.org_id());

CREATE POLICY bids_select_tender_owner ON bids
  FOR SELECT
  USING (
    tender_id IN (
      SELECT id FROM tenders WHERE org_id = auth.org_id()
    )
  );

CREATE POLICY bids_insert_recycler ON bids
  FOR INSERT
  WITH CHECK (
    bidder_org_id = auth.org_id()
    AND (auth.has_role('admin') OR auth.has_role('operations'))
    AND EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = auth.org_id() AND o.type = 'recycler'
    )
  );

-- No DELETE on bids either.

-- ----- Policies: audit_events -----------------------------
-- Anyone in the org can SELECT their org's audit trail.
-- INSERT is unrestricted (the trigger writes; we'll handle authorization upstream).
-- NO UPDATE, NO DELETE — append-only invariant.

CREATE POLICY audit_select_own_org ON audit_events
  FOR SELECT
  USING (org_id = auth.org_id() OR org_id IS NULL);

CREATE POLICY audit_insert_authenticated ON audit_events
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL OR true);
  -- (We allow system inserts too; the trigger sets user_id from auth.uid() if available.)

-- ----- Policies: idempotency_keys -------------------------

CREATE POLICY idempotency_select_own_org ON idempotency_keys
  FOR SELECT
  USING (org_id = auth.org_id());

CREATE POLICY idempotency_insert_own_org ON idempotency_keys
  FOR INSERT
  WITH CHECK (org_id = auth.org_id());

-- ----- Audit hash chain trigger ---------------------------
-- Each audit_events row links to the previous row via SHA-256 hash.
-- Tampering is detectable: re-compute hashes, mismatched chain
-- means someone touched history (or RLS prevented it, since
-- update/delete have no policies = denied by default).

CREATE OR REPLACE FUNCTION compute_audit_hash() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prev text;
BEGIN
  -- Use the *globally* most recent audit row as predecessor
  -- (rather than per-org), so the chain links the entire log.
  -- Trade-off: easier to verify globally, slightly slower writes.
  SELECT hash INTO prev FROM audit_events
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  NEW.prev_hash := COALESCE(prev, '');
  NEW.hash := encode(
    digest(
      coalesce(NEW.prev_hash, '') ||
      coalesce(NEW.action, '') ||
      coalesce(NEW.entity_type, '') ||
      coalesce(NEW.entity_id::text, '') ||
      coalesce(NEW.payload::text, '') ||
      coalesce(NEW.created_at::text, ''),
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_events_hash_chain
  BEFORE INSERT ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION compute_audit_hash();

-- ----- updated_at automation ------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenders_set_updated_at
  BEFORE UPDATE ON tenders
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ----- Add tenders + bids + audit_events to realtime publication --

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE tenders; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE bids; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE audit_events; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
