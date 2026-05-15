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
    notes: text("notes"),
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
