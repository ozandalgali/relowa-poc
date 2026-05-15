CREATE TYPE "public"."carrier_ad_status" AS ENUM('open', 'closing', 'awarded', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."carrier_bid_status" AS ENUM('submitted', 'withdrawn', 'rejected', 'accepted');--> statement-breakpoint
CREATE TYPE "public"."escrow_status" AS ENUM('pending', 'funds_locked', 'in_transit', 'delivered', 'released', 'refunded', 'disputed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('pending', 'in_transit', 'delivered', 'disputed', 'completed');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('super_admin', 'account_manager', 'support_agent', 'compliance_officer', 'financial_analyst');--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_org_id" uuid,
	"target_user_id" uuid,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"client_ip" text NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anchor_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merkle_root" text NOT NULL,
	"audit_event_count" integer NOT NULL,
	"cert_count" integer DEFAULT 0 NOT NULL,
	"block_number" integer,
	"tx_hash" text,
	"anchored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"recycler_org_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"pickup_lat" numeric(9, 6) NOT NULL,
	"pickup_lng" numeric(9, 6) NOT NULL,
	"pickup_address" text NOT NULL,
	"dropoff_lat" numeric(9, 6) NOT NULL,
	"dropoff_lng" numeric(9, 6) NOT NULL,
	"dropoff_address" text NOT NULL,
	"weight_kg" integer NOT NULL,
	"vehicle_type" text NOT NULL,
	"pickup_window_start" timestamp with time zone NOT NULL,
	"pickup_window_end" timestamp with time zone NOT NULL,
	"notes" text,
	"status" "carrier_ad_status" DEFAULT 'open' NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"winner_bid_id" uuid,
	"awarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_ad_id" uuid NOT NULL,
	"carrier_org_id" uuid NOT NULL,
	"bidder_user_id" uuid NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"estimated_eta" timestamp with time zone NOT NULL,
	"vehicle_capacity_kg" integer NOT NULL,
	"ai_score_value" numeric(4, 2),
	"ai_score_speed" numeric(4, 2),
	"ai_label" text,
	"status" "carrier_bid_status" DEFAULT 'submitted' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrow_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"shipment_id" uuid,
	"buyer_org_id" uuid NOT NULL,
	"seller_org_id" uuid NOT NULL,
	"carrier_org_id" uuid,
	"waste_amount" numeric(14, 2) NOT NULL,
	"transport_amount" numeric(14, 2),
	"currency" text DEFAULT 'TRY' NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text,
	"state_machine_arn" text,
	"status" "escrow_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"funded_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"dispute_opened_at" timestamp with time zone,
	"dispute_reason" text
);
--> statement-breakpoint
CREATE TABLE "escrow_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"escrow_order_id" uuid NOT NULL,
	"tx_type" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"provider_tx_id" text,
	"status" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"saml_subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "internal_staff_email_unique" UNIQUE("email"),
	CONSTRAINT "internal_staff_saml_subject_unique" UNIQUE("saml_subject")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"org_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "provider_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature_valid" boolean NOT NULL,
	"processed_at" timestamp with time zone,
	"related_escrow_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" uuid,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"carrier_ad_id" uuid,
	"carrier_org_id" uuid NOT NULL,
	"recycler_org_id" uuid NOT NULL,
	"producer_org_id" uuid NOT NULL,
	"agreed_price" numeric(14, 2) NOT NULL,
	"status" "shipment_status" DEFAULT 'pending' NOT NULL,
	"pickup_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"irsaliye_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_org_assignments" (
	"staff_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid NOT NULL,
	CONSTRAINT "staff_org_assignments_staff_id_org_id_pk" PRIMARY KEY("staff_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "staff_permissions" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"risk" "risk_level" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_role_permissions" (
	"role" "staff_role" NOT NULL,
	"permission_code" text NOT NULL,
	CONSTRAINT "staff_role_permissions_role_permission_code_pk" PRIMARY KEY("role","permission_code")
);
--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_staff_id_internal_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."internal_staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_target_org_id_organizations_id_fk" FOREIGN KEY ("target_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_ads" ADD CONSTRAINT "carrier_ads_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_ads" ADD CONSTRAINT "carrier_ads_recycler_org_id_organizations_id_fk" FOREIGN KEY ("recycler_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_ads" ADD CONSTRAINT "carrier_ads_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_bids" ADD CONSTRAINT "carrier_bids_carrier_ad_id_carrier_ads_id_fk" FOREIGN KEY ("carrier_ad_id") REFERENCES "public"."carrier_ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_bids" ADD CONSTRAINT "carrier_bids_carrier_org_id_organizations_id_fk" FOREIGN KEY ("carrier_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_bids" ADD CONSTRAINT "carrier_bids_bidder_user_id_users_id_fk" FOREIGN KEY ("bidder_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_orders" ADD CONSTRAINT "escrow_orders_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_orders" ADD CONSTRAINT "escrow_orders_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_orders" ADD CONSTRAINT "escrow_orders_buyer_org_id_organizations_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_orders" ADD CONSTRAINT "escrow_orders_seller_org_id_organizations_id_fk" FOREIGN KEY ("seller_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_orders" ADD CONSTRAINT "escrow_orders_carrier_org_id_organizations_id_fk" FOREIGN KEY ("carrier_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_transactions_escrow_order_id_escrow_orders_id_fk" FOREIGN KEY ("escrow_order_id") REFERENCES "public"."escrow_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_staff" ADD CONSTRAINT "internal_staff_created_by_internal_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."internal_staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_webhooks" ADD CONSTRAINT "provider_webhooks_related_escrow_id_escrow_orders_id_fk" FOREIGN KEY ("related_escrow_id") REFERENCES "public"."escrow_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_carrier_ad_id_carrier_ads_id_fk" FOREIGN KEY ("carrier_ad_id") REFERENCES "public"."carrier_ads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_carrier_org_id_organizations_id_fk" FOREIGN KEY ("carrier_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_recycler_org_id_organizations_id_fk" FOREIGN KEY ("recycler_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_producer_org_id_organizations_id_fk" FOREIGN KEY ("producer_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_org_assignments" ADD CONSTRAINT "staff_org_assignments_staff_id_internal_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."internal_staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_org_assignments" ADD CONSTRAINT "staff_org_assignments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_org_assignments" ADD CONSTRAINT "staff_org_assignments_assigned_by_internal_staff_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."internal_staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_role_permissions" ADD CONSTRAINT "staff_role_permissions_permission_code_staff_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."staff_permissions"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_staff_idx" ON "admin_audit_log" USING btree ("staff_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_target_org_idx" ON "admin_audit_log" USING btree ("target_org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_action_idx" ON "admin_audit_log" USING btree ("action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "anchor_log_created_idx" ON "anchor_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "carrier_ads_tender_idx" ON "carrier_ads" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX "carrier_ads_recycler_idx" ON "carrier_ads" USING btree ("recycler_org_id");--> statement-breakpoint
CREATE INDEX "carrier_ads_status_idx" ON "carrier_ads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "carrier_ads_pickup_geo_idx" ON "carrier_ads" USING btree ("pickup_lat","pickup_lng");--> statement-breakpoint
CREATE INDEX "carrier_bids_ad_idx" ON "carrier_bids" USING btree ("carrier_ad_id");--> statement-breakpoint
CREATE INDEX "carrier_bids_carrier_idx" ON "carrier_bids" USING btree ("carrier_org_id");--> statement-breakpoint
CREATE INDEX "carrier_bids_status_idx" ON "carrier_bids" USING btree ("status");--> statement-breakpoint
CREATE INDEX "escrow_orders_tender_idx" ON "escrow_orders" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX "escrow_orders_buyer_idx" ON "escrow_orders" USING btree ("buyer_org_id");--> statement-breakpoint
CREATE INDEX "escrow_orders_seller_idx" ON "escrow_orders" USING btree ("seller_org_id");--> statement-breakpoint
CREATE INDEX "escrow_orders_carrier_idx" ON "escrow_orders" USING btree ("carrier_org_id");--> statement-breakpoint
CREATE INDEX "escrow_orders_status_idx" ON "escrow_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "escrow_tx_order_idx" ON "escrow_transactions" USING btree ("escrow_order_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("created_at") WHERE published_at IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_aggregate_idx" ON "outbox" USING btree ("aggregate_type","aggregate_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_webhooks_event_idx" ON "provider_webhooks" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "provider_webhooks_unprocessed_idx" ON "provider_webhooks" USING btree ("created_at") WHERE processed_at IS NULL;--> statement-breakpoint
CREATE INDEX "shipment_events_shipment_idx" ON "shipment_events" USING btree ("shipment_id","created_at");--> statement-breakpoint
CREATE INDEX "shipments_tender_idx" ON "shipments" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX "shipments_carrier_idx" ON "shipments" USING btree ("carrier_org_id");--> statement-breakpoint
CREATE INDEX "shipments_recycler_idx" ON "shipments" USING btree ("recycler_org_id");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status");