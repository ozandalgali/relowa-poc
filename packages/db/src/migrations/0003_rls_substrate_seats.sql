-- ─── M5 substrate seats — RLS policies for 27 new tables ──────────
-- Side-car migration for ADR-0024 through 0029 + PRD-0008 pricing.
-- Each table gets ENABLE RLS + SELECT/INSERT policies.
-- These are "substrate seats" — tables exist empty, ready for Phase 2-3.

-- ─── Enable RLS on all new tables ──────────────────────────────────

ALTER TABLE subscription_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_usage_counters ENABLE ROW LEVEL SECURITY;

ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_proofs ENABLE ROW LEVEL SECURITY;

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_optimizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_stops ENABLE ROW LEVEL SECURITY;

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_aggregations ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_alerts ENABLE ROW LEVEL SECURITY;

ALTER TABLE ai_inference_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE inference_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE inference_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_unit_commands ENABLE ROW LEVEL SECURITY;

ALTER TABLE fee_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_schedule_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_schedule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_applications ENABLE ROW LEVEL SECURITY;

-- ─── Subscription tiers — public read, system write ────────────────

DROP POLICY IF EXISTS subscription_tiers_select ON subscription_tiers;
CREATE POLICY subscription_tiers_select ON subscription_tiers FOR SELECT TO app_user USING (is_active = true);

-- ─── Org subscriptions — own org ───────────────────────────────────

DROP POLICY IF EXISTS org_subscriptions_select_own ON org_subscriptions;
CREATE POLICY org_subscriptions_select_own ON org_subscriptions FOR SELECT TO app_user USING (auth.org_id() = org_id);

DROP POLICY IF EXISTS subscription_invoices_select_own ON subscription_invoices;
CREATE POLICY subscription_invoices_select_own ON subscription_invoices FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM org_subscriptions os WHERE os.id = subscription_invoices.subscription_id AND os.org_id = auth.org_id()));

-- ─── Facilities — own org ──────────────────────────────────────────

DROP POLICY IF EXISTS facilities_select_own ON facilities;
CREATE POLICY facilities_select_own ON facilities FOR SELECT TO app_user USING (auth.org_id() = org_id);

DROP POLICY IF EXISTS facilities_insert_own ON facilities;
CREATE POLICY facilities_insert_own ON facilities FOR INSERT TO app_user WITH CHECK (auth.org_id() = org_id AND auth.has_role('admin'));

-- ─── Orders — involved parties ─────────────────────────────────────

DROP POLICY IF EXISTS orders_select_involved ON orders;
CREATE POLICY orders_select_involved ON orders FOR SELECT TO app_user
  USING (auth.org_id() IN (buyer_org_id, seller_org_id));

DROP POLICY IF EXISTS order_parties_select_involved ON order_parties;
CREATE POLICY order_parties_select_involved ON order_parties FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_parties.order_id AND auth.org_id() IN (o.buyer_org_id, o.seller_org_id)));

DROP POLICY IF EXISTS order_status_transitions_select ON order_status_transitions;
CREATE POLICY order_status_transitions_select ON order_status_transitions FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_status_transitions.order_id AND auth.org_id() IN (o.buyer_org_id, o.seller_org_id)));

DROP POLICY IF EXISTS quality_inspections_select ON quality_inspections;
CREATE POLICY quality_inspections_select ON quality_inspections FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = quality_inspections.order_id AND auth.org_id() IN (o.buyer_org_id, o.seller_org_id)));

DROP POLICY IF EXISTS delivery_proofs_select ON delivery_proofs;
CREATE POLICY delivery_proofs_select ON delivery_proofs FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = delivery_proofs.order_id AND auth.org_id() IN (o.buyer_org_id, o.seller_org_id)));

-- ─── VRP — admin/system access only for Phase 1 ────────────────────

-- Vehicles, drivers, routes, legs, stops are system-internal in P1
-- P1 ships schema; P2 adds carrier-side access policies

-- ─── IoT — admin/system access only for Phase 1 ────────────────────

-- Devices, telemetry, aggregations, alerts are system-only in P1
-- P1 ships schema; P2 adds facility-operator dashboards

-- ─── Edge AI — admin/system access only for Phase 1 ────────────────

-- AI units, models, jobs, results, commands are system-only in P1
-- P1 ships schema; P2 adds quality-scoring dashboards

-- ─── Pricing — admin only (system-managed by super_admin) ──────────

DROP POLICY IF EXISTS fee_schedules_select ON fee_schedules;
CREATE POLICY fee_schedules_select ON fee_schedules FOR SELECT TO app_user USING (is_active = true);

DROP POLICY IF EXISTS fee_applications_select_own ON fee_applications;
CREATE POLICY fee_applications_select_own ON fee_applications FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM escrow_orders eo WHERE eo.id = fee_applications.escrow_order_id AND auth.org_id() IN (eo.buyer_org_id, eo.seller_org_id)));

-- ─── Update schema_version_counter in org_usage_counters ──────────────
