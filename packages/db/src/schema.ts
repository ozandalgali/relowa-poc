/**
 * Relowa POC schema
 *
 * Multi-tenant model:
 *  - organizations are tenants (Producer/Recycler/Carrier)
 *  - users belong to organizations via org_members
 *  - users can be in multiple orgs; "active org" travels in JWT
 *
 * RLS principles:
 *  - All app tables have RLS ENABLED
 *  - Policies use auth.uid(), auth.org_id(), auth.has_role() helpers
 *  - audit_events is INSERT-only (no UPDATE, no DELETE policy)
 *  - Hash chain on audit_events for tamper detection
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  timestamp,
  integer,
  numeric,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================================
// Enums
// ============================================================

export const orgTypeEnum = pgEnum("org_type", ["producer", "recycler", "carrier"]);

export const orgRoleEnum = pgEnum("org_role", ["admin", "operations", "accounting"]);

export const tenderStatusEnum = pgEnum("tender_status", [
  "draft",
  "published",
  "closing",
  "won",
  "funded",
  "delivered",
  "settled",
  "cancelled",
  "disputed",
]);

export const materialTypeEnum = pgEnum("material_type", [
  "metal_scrap",
  "plastic",
  "paper",
  "electronic",
  "chemical",
  "other",
]);

// ─── Staff RBAC (ADR-0014) ────────────────────────────────────────

export const staffRoleEnum = pgEnum("staff_role", [
  "super_admin",
  "account_manager",
  "support_agent",
  "compliance_officer",
  "financial_analyst",
]);

export const riskLevelEnum = pgEnum("risk_level", ["low", "medium", "high", "critical"]);

// ─── Carrier sub-auction (ADR-0010) ───────────────────────────────

export const carrierAdStatusEnum = pgEnum("carrier_ad_status", [
  "open",
  "closing",
  "awarded",
  "cancelled",
  "expired",
]);

export const carrierBidStatusEnum = pgEnum("carrier_bid_status", [
  "submitted",
  "withdrawn",
  "rejected",
  "accepted",
]);

export const shipmentStatusEnum = pgEnum("shipment_status", [
  "pending",
  "in_transit",
  "delivered",
  "disputed",
  "completed",
]);

// ─── Escrow (ADR-0007) ────────────────────────────────────────────

export const escrowStatusEnum = pgEnum("escrow_status", [
  "pending",
  "funds_locked",
  "in_transit",
  "delivered",
  "released",
  "refunded",
  "disputed",
  "failed",
]);

// ─── Subscriptions (ADR-0024) ─────────────────────────────────────

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "past_due",
  "cancelled",
  "expired",
]);

// ─── Facilities (ADR-0025) ────────────────────────────────────────

export const facilityTypeEnum = pgEnum("facility_type", [
  "factory",
  "warehouse",
  "transfer_station",
  "recycling_plant",
  "landfill",
  "other",
]);

// ─── Orders (ADR-0026) ────────────────────────────────────────────

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "accepted",
  "in_transit",
  "delivered",
  "disputed",
  "completed",
  "cancelled",
]);

export const inspectionOutcomeEnum = pgEnum("inspection_outcome", [
  "pass",
  "fail",
  "conditional",
]);

// ─── VRP / Route Engine (ADR-0027) ────────────────────────────────

export const vehicleTypeEnum = pgEnum("vehicle_type", [
  "truck_3_5t",
  "truck_7_5t",
  "truck_24t",
  "tanker",
  "other",
]);

export const vehicleStatusEnum = pgEnum("vehicle_status", [
  "idle",
  "en_route",
  "loading",
  "unloading",
  "maintenance",
]);

// ─── IoT (ADR-0028) ───────────────────────────────────────────────

export const deviceTypeEnum = pgEnum("device_type", [
  "weight_sensor",
  "fill_level_sensor",
  "gps_tracker",
  "camera",
  "environmental_sensor",
]);

export const deviceStatusEnum = pgEnum("device_status", [
  "online",
  "offline",
  "maintenance",
  "error",
]);

export const connectivityProtocolEnum = pgEnum("connectivity_protocol", [
  "mqtt",
  "lora",
  "cellular",
  "wifi",
  "ethernet",
]);

// ─── Edge AI (ADR-0029) ───────────────────────────────────────────

export const inferenceUnitTypeEnum = pgEnum("inference_unit_type", [
  "waste_classifier",
  "contamination_detector",
  "volume_estimator",
  "material_sorter",
  "custom",
]);

export const inferenceUnitStatusEnum = pgEnum("inference_unit_status", [
  "idle",
  "inferring",
  "error",
  "offline",
]);

// ============================================================
// Identity & tenancy
// ============================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: orgTypeEnum("type").notNull(),
    name: text("name").notNull(),
    vergiNo: varchar("vergi_no", { length: 20 }),
    address: text("address"),
    region: text("region"), // e.g. "Kocaeli", used for matching
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("organizations_type_idx").on(t.type),
    index("organizations_region_idx").on(t.region),
  ],
);

export const orgMembers = pgTable(
  "org_members",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRoleEnum("role").notNull(),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("org_members_user_idx").on(t.userId)],
);

// ============================================================
// Business: tenders & bids
// ============================================================

export const tenders = pgTable(
  "tenders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    materialType: materialTypeEnum("material_type").notNull(),
    quantityTons: numeric("quantity_tons", { precision: 12, scale: 3 }).notNull(),
    pickupRegion: text("pickup_region").notNull(),
    pickupAddress: text("pickup_address"),
    pickupFacilityId: uuid("pickup_facility_id").references(() => facilities.id),
    dropoffFacilityId: uuid("dropoff_facility_id").references(() => facilities.id),
    notes: text("notes"),
    allowPartialAward: boolean("allow_partial_award").notNull().default(false),
    status: tenderStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    winnerBidId: uuid("winner_bid_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tenders_org_idx").on(t.orgId),
    index("tenders_status_idx").on(t.status),
    index("tenders_material_region_idx").on(t.materialType, t.pickupRegion),
    index("tenders_closes_at_idx").on(t.closesAt),
  ],
);

export const bids = pgTable(
  "bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenderId: uuid("tender_id")
      .notNull()
      .references(() => tenders.id, { onDelete: "cascade" }),
    bidderOrgId: uuid("bidder_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    bidderUserId: uuid("bidder_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    pricePerTon: numeric("price_per_ton", { precision: 14, scale: 2 }).notNull(),
    includesShipping: boolean("includes_shipping").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bids_tender_idx").on(t.tenderId), index("bids_bidder_org_idx").on(t.bidderOrgId)],
);

// ============================================================
// Cross-cutting: audit, idempotency
// ============================================================

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id"),
    userId: uuid("user_id"),
    action: text("action").notNull(), // e.g. "tender.created", "bid.placed"
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_org_idx").on(t.orgId),
    index("audit_events_entity_idx").on(t.entityType, t.entityId),
    index("audit_events_created_idx").on(t.createdAt),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").notNull(),
    orgId: uuid("org_id").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.orgId] }),
    index("idempotency_expires_idx").on(t.expiresAt),
  ],
);

// ============================================================
// Staff RBAC (ADR-0014) — accessed by relowa_admin, no RLS
// ============================================================

export const internalStaff = pgTable(
  "internal_staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    fullName: text("full_name").notNull(),
    role: staffRoleEnum("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    samlSubject: text("saml_subject").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references((): any => internalStaff.id),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  },
);

export const staffOrgAssignments = pgTable(
  "staff_org_assignments",
  {
    staffId: uuid("staff_id")
      .notNull()
      .references(() => internalStaff.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid("assigned_by")
      .notNull()
      .references(() => internalStaff.id),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.orgId] })],
);

export const staffPermissions = pgTable("staff_permissions", {
  code: text("code").primaryKey(),
  description: text("description").notNull(),
  risk: riskLevelEnum("risk").notNull(),
});

export const staffRolePermissions = pgTable(
  "staff_role_permissions",
  {
    role: staffRoleEnum("role").notNull(),
    permissionCode: text("permission_code")
      .notNull()
      .references(() => staffPermissions.code, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.role, t.permissionCode] })],
);

export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => internalStaff.id),
    action: text("action").notNull(),
    targetOrgId: uuid("target_org_id").references(() => organizations.id),
    targetUserId: uuid("target_user_id").references(() => users.id),
    reason: text("reason").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    clientIp: text("client_ip").notNull(),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("admin_audit_staff_idx").on(t.staffId, t.createdAt.desc()),
    index("admin_audit_target_org_idx").on(t.targetOrgId, t.createdAt.desc()),
    index("admin_audit_action_idx").on(t.action, t.createdAt.desc()),
  ],
);

// ============================================================
// Carrier sub-auction (ADR-0010)
// ============================================================

export const carrierAds = pgTable(
  "carrier_ads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenderId: uuid("tender_id")
      .notNull()
      .references(() => tenders.id, { onDelete: "restrict" }),
    recyclerOrgId: uuid("recycler_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    pickupLat: numeric("pickup_lat", { precision: 9, scale: 6 }).notNull(),
    pickupLng: numeric("pickup_lng", { precision: 9, scale: 6 }).notNull(),
    pickupAddress: text("pickup_address").notNull(),
    dropoffLat: numeric("dropoff_lat", { precision: 9, scale: 6 }).notNull(),
    dropoffLng: numeric("dropoff_lng", { precision: 9, scale: 6 }).notNull(),
    dropoffAddress: text("dropoff_address").notNull(),
    weightKg: integer("weight_kg").notNull(),
    vehicleType: text("vehicle_type").notNull(),
    pickupWindowStart: timestamp("pickup_window_start", { withTimezone: true }).notNull(),
    pickupWindowEnd: timestamp("pickup_window_end", { withTimezone: true }).notNull(),
    notes: text("notes"),
    orderId: uuid("order_id").references(() => orders.id),
    status: carrierAdStatusEnum("status").notNull().default("open"),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    winnerBidId: uuid("winner_bid_id"),
    awardedAt: timestamp("awarded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("carrier_ads_tender_idx").on(t.tenderId),
    index("carrier_ads_recycler_idx").on(t.recyclerOrgId),
    index("carrier_ads_status_idx").on(t.status),
    index("carrier_ads_pickup_geo_idx").on(t.pickupLat, t.pickupLng),
  ],
);

export const carrierBids = pgTable(
  "carrier_bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    carrierAdId: uuid("carrier_ad_id")
      .notNull()
      .references(() => carrierAds.id, { onDelete: "cascade" }),
    carrierOrgId: uuid("carrier_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    bidderUserId: uuid("bidder_user_id")
      .notNull()
      .references(() => users.id),
    price: numeric("price", { precision: 14, scale: 2 }).notNull(),
    estimatedEta: timestamp("estimated_eta", { withTimezone: true }).notNull(),
    vehicleCapacityKg: integer("vehicle_capacity_kg").notNull(),
    aiScoreValue: numeric("ai_score_value", { precision: 4, scale: 2 }),
    aiScoreSpeed: numeric("ai_score_speed", { precision: 4, scale: 2 }),
    aiLabel: text("ai_label"),
    status: carrierBidStatusEnum("status").notNull().default("submitted"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("carrier_bids_ad_idx").on(t.carrierAdId),
    index("carrier_bids_carrier_idx").on(t.carrierOrgId),
    index("carrier_bids_status_idx").on(t.status),
  ],
);

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenderId: uuid("tender_id")
      .notNull()
      .references(() => tenders.id, { onDelete: "restrict" }),
    carrierAdId: uuid("carrier_ad_id").references(() => carrierAds.id, {
      onDelete: "set null",
    }),
    carrierOrgId: uuid("carrier_org_id")
      .notNull()
      .references(() => organizations.id),
    recyclerOrgId: uuid("recycler_org_id")
      .notNull()
      .references(() => organizations.id),
    producerOrgId: uuid("producer_org_id")
      .notNull()
      .references(() => organizations.id),
    agreedPrice: numeric("agreed_price", { precision: 14, scale: 2 }).notNull(),
    status: shipmentStatusEnum("status").notNull().default("pending"),
    pickupAt: timestamp("pickup_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    irsaliyeNo: text("irsaliye_no"),
    routeLegId: uuid("route_leg_id").references(() => routeLegs.id),
    sequenceInLeg: integer("sequence_in_leg"),
    pickupFacilityId: uuid("pickup_facility_id").references(() => facilities.id),
    dropoffFacilityId: uuid("dropoff_facility_id").references(() => facilities.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shipments_tender_idx").on(t.tenderId),
    index("shipments_carrier_idx").on(t.carrierOrgId),
    index("shipments_recycler_idx").on(t.recyclerOrgId),
    index("shipments_status_idx").on(t.status),
  ],
);

export const shipmentEvents = pgTable(
  "shipment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shipment_events_shipment_idx").on(t.shipmentId, t.createdAt)],
);

// ============================================================
// Escrow (ADR-0007)
// ============================================================

export const escrowOrders = pgTable(
  "escrow_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenderId: uuid("tender_id")
      .notNull()
      .references(() => tenders.id, { onDelete: "restrict" }),
    shipmentId: uuid("shipment_id").references(() => shipments.id),
    buyerOrgId: uuid("buyer_org_id")
      .notNull()
      .references(() => organizations.id),
    sellerOrgId: uuid("seller_org_id")
      .notNull()
      .references(() => organizations.id),
    carrierOrgId: uuid("carrier_org_id").references(() => organizations.id),
    wasteAmount: numeric("waste_amount", { precision: 14, scale: 2 }).notNull(),
    transportAmount: numeric("transport_amount", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("TRY"),
    provider: text("provider").notNull(),
    providerOrderId: text("provider_order_id"),
    stateMachineArn: text("state_machine_arn"),
    status: escrowStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    fundedAt: timestamp("funded_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    disputeOpenedAt: timestamp("dispute_opened_at", { withTimezone: true }),
    disputeReason: text("dispute_reason"),
  },
  (t) => [
    index("escrow_orders_tender_idx").on(t.tenderId),
    index("escrow_orders_buyer_idx").on(t.buyerOrgId),
    index("escrow_orders_seller_idx").on(t.sellerOrgId),
    index("escrow_orders_carrier_idx").on(t.carrierOrgId),
    index("escrow_orders_status_idx").on(t.status),
  ],
);

export const escrowTransactions = pgTable(
  "escrow_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    escrowOrderId: uuid("escrow_order_id")
      .notNull()
      .references(() => escrowOrders.id, { onDelete: "restrict" }),
    txType: text("tx_type").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    providerTxId: text("provider_tx_id"),
    status: text("status").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("escrow_tx_order_idx").on(t.escrowOrderId, t.createdAt)],
);

export const providerWebhooks = pgTable(
  "provider_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    payload: jsonb("payload").notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    relatedEscrowId: uuid("related_escrow_id").references(() => escrowOrders.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("provider_webhooks_event_idx").on(t.provider, t.providerEventId),
    index("provider_webhooks_unprocessed_idx")
      .on(t.createdAt)
      .where(sql`processed_at IS NULL`),
  ],
);

// ============================================================
// Outbox (ADR-0006)
// ============================================================

export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    orgId: uuid("org_id"),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [
    index("outbox_unpublished_idx")
      .on(t.createdAt)
      .where(sql`published_at IS NULL`),
    index("outbox_aggregate_idx").on(t.aggregateType, t.aggregateId, t.createdAt),
  ],
);

// ============================================================
// Anchor log (ADR-0008)
// ============================================================

export const anchorLog = pgTable(
  "anchor_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merkleRoot: text("merkle_root").notNull(),
    auditEventCount: integer("audit_event_count").notNull(),
    certCount: integer("cert_count").notNull().default(0),
    blockNumber: integer("block_number"),
    txHash: text("tx_hash"),
    anchoredAt: timestamp("anchored_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("anchor_log_created_idx").on(t.createdAt.desc())],
);

// ============================================================
// PRD-0008 — Pricing engine (hybrid SaaS + commission)
// ============================================================

export const feeSchedules = pgTable(
  "fee_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    segment: orgTypeEnum("segment").notNull(),
    tier: text("tier").notNull(),
    commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }).notNull(),
    capAmount: numeric("cap_amount", { precision: 14, scale: 2 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const feeScheduleTiers = pgTable(
  "fee_schedule_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => feeSchedules.id, { onDelete: "cascade" }),
    minVolume: numeric("min_volume", { precision: 14, scale: 2 }),
    maxVolume: numeric("max_volume", { precision: 14, scale: 2 }),
    rate: numeric("rate", { precision: 14, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const feeScheduleOverrides = pgTable(
  "fee_schedule_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => feeSchedules.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => internalStaff.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
);

export const feeApplications = pgTable(
  "fee_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feeScheduleId: uuid("fee_schedule_id")
      .notNull()
      .references(() => feeSchedules.id, { onDelete: "restrict" }),
    escrowOrderId: uuid("escrow_order_id").references(() => escrowOrders.id, { onDelete: "restrict" }),
    computedAmount: numeric("computed_amount", { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// ============================================================
// ADR-0024 — Subscription tiers + billing
// ============================================================

export const subscriptionTiers = pgTable(
  "subscription_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    segment: orgTypeEnum("segment").notNull(),
    tier: text("tier").notNull(),
    priceMonthly: numeric("price_monthly", { precision: 10, scale: 2 }).notNull(),
    features: jsonb("features").notNull().default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const orgSubscriptions = pgTable(
  "org_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => subscriptionTiers.id, { onDelete: "restrict" }),
    status: subscriptionStatusEnum("status").notNull().default("active"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const subscriptionInvoices = pgTable(
  "subscription_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => orgSubscriptions.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    status: text("status").notNull().default("pending"),
    dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const orgUsageCounters = pgTable(
  "org_usage_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    counterName: text("counter_name").notNull(),
    currentValue: integer("current_value").notNull().default(0),
    limitValue: integer("limit_value"),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// ============================================================
// ADR-0025 — Facilities (multi-site)
// ============================================================

export const facilities = pgTable(
  "facilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    type: facilityTypeEnum("type").notNull(),
    address: text("address").notNull(),
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    cevreLisansiNo: text("cevre_lisansi_no"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// ============================================================
// ADR-0026 — Orders (separate from tenders)
// ============================================================

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenderId: uuid("tender_id")
      .notNull()
      .references(() => tenders.id, { onDelete: "restrict" }),
    buyerOrgId: uuid("buyer_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    sellerOrgId: uuid("seller_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    winningBidId: uuid("winning_bid_id").references(() => bids.id),
    quantityTons: numeric("quantity_tons", { precision: 12, scale: 3 }).notNull(),
    pricePerTon: numeric("price_per_ton", { precision: 14, scale: 2 }).notNull(),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),
    status: orderStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("orders_tender_idx").on(t.tenderId),
    index("orders_buyer_idx").on(t.buyerOrgId),
    index("orders_status_idx").on(t.status),
  ],
);

export const orderParties = pgTable(
  "order_parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const orderStatusTransitions = pgTable(
  "order_status_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: orderStatusEnum("from_status").notNull(),
    toStatus: orderStatusEnum("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const qualityInspections = pgTable(
  "quality_inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    inspectorOrgId: uuid("inspector_org_id")
      .notNull()
      .references(() => organizations.id),
    outcome: inspectionOutcomeEnum("outcome").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const deliveryProofs = pgTable(
  "delivery_proofs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    irsaliyeNo: text("irsaliye_no"),
    signatureUrl: text("signature_url"),
    photoUrls: jsonb("photo_urls").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// ============================================================
// ADR-0027 — VRP / Route Engine (substrate seat)
// ============================================================

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    plate: text("plate").notNull(),
    type: vehicleTypeEnum("type").notNull().default("truck_24t"),
    capacityKg: integer("capacity_kg").notNull(),
    status: vehicleStatusEnum("status").notNull().default("idle"),
    currentLat: numeric("current_lat", { precision: 9, scale: 6 }),
    currentLng: numeric("current_lng", { precision: 9, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const driverProfiles = pgTable(
  "driver_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id").references(() => users.id),
    fullName: text("full_name").notNull(),
    licenseNumber: text("license_number"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const routeOptimizations = pgTable(
  "route_optimizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    status: text("status").notNull().default("pending"),
    inputPayload: jsonb("input_payload").notNull().default(sql`'{}'::jsonb`),
    outputPayload: jsonb("output_payload"),
    engine: text("engine").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const routeLegs = pgTable(
  "route_legs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    optimizationId: uuid("optimization_id")
      .notNull()
      .references(() => routeOptimizations.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id),
    driverId: uuid("driver_id").references(() => driverProfiles.id),
    sequence: integer("sequence").notNull().default(0),
    startLat: numeric("start_lat", { precision: 9, scale: 6 }),
    startLng: numeric("start_lng", { precision: 9, scale: 6 }),
    endLat: numeric("end_lat", { precision: 9, scale: 6 }),
    endLng: numeric("end_lng", { precision: 9, scale: 6 }),
    estimatedDurationMin: integer("estimated_duration_min"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const shipmentStops = pgTable(
  "shipment_stops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    legId: uuid("leg_id").references(() => routeLegs.id),
    sequence: integer("sequence").notNull().default(0),
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    address: text("address"),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    departedAt: timestamp("departed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// ============================================================
// ADR-0028 — IoT ingestion (substrate seat)
// ============================================================

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    facilityId: uuid("facility_id").references(() => facilities.id),
    name: text("name").notNull(),
    type: deviceTypeEnum("type").notNull(),
    status: deviceStatusEnum("status").notNull().default("offline"),
    connectivity: connectivityProtocolEnum("connectivity").notNull().default("mqtt"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const deviceTelemetry = pgTable(
  "device_telemetry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("device_telemetry_device_idx").on(t.deviceId, t.receivedAt.desc())],
);

export const telemetryAggregations = pgTable(
  "telemetry_aggregations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    aggType: text("agg_type").notNull(),
    aggValue: numeric("agg_value", { precision: 14, scale: 4 }),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const deviceAlerts = pgTable(
  "device_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    alertType: text("alert_type").notNull(),
    severity: text("severity").notNull().default("info"),
    message: text("message").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// ============================================================
// ADR-0029 — Edge AI (substrate seat)
// ============================================================

export const aiInferenceUnits = pgTable(
  "ai_inference_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    facilityId: uuid("facility_id").references(() => facilities.id),
    name: text("name").notNull(),
    type: inferenceUnitTypeEnum("type").notNull(),
    status: inferenceUnitStatusEnum("status").notNull().default("idle"),
    modelId: uuid("model_id"),
    lastInferenceAt: timestamp("last_inference_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const mlModels = pgTable(
  "ml_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    framework: text("framework").notNull(),
    accuracy: numeric("accuracy", { precision: 5, scale: 4 }),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const inferenceJobs = pgTable(
  "inference_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => aiInferenceUnits.id, { onDelete: "cascade" }),
    modelId: uuid("model_id").references(() => mlModels.id),
    status: text("status").notNull().default("pending"),
    inputPayload: jsonb("input_payload"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const inferenceResults = pgTable(
  "inference_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => inferenceJobs.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => aiInferenceUnits.id, { onDelete: "cascade" }),
    labels: jsonb("labels").notNull().default(sql`'[]'::jsonb`),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    rawOutput: jsonb("raw_output"),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inference_results_job_idx").on(t.jobId, t.createdAt.desc())],
);

export const aiUnitCommands = pgTable(
  "ai_unit_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => aiInferenceUnits.id, { onDelete: "cascade" }),
    command: text("command").notNull(),
    payload: jsonb("payload"),
    status: text("status").notNull().default("pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
