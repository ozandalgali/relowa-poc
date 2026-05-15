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
