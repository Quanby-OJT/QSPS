CREATE TABLE "payment_events" (
	"id" serial PRIMARY KEY,
	"payment_id" integer,
	"provider_code" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature_valid" boolean NOT NULL,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY,
	"booking_id" integer NOT NULL,
	"channel_code" text NOT NULL,
	"provider_code" text NOT NULL,
	"provider_reference" text,
	"amount_centavos" integer NOT NULL,
	"convenience_fee_centavos" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'initiated' NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"collected_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_provider_event_uq" ON "payment_events" ("provider_code","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_events_payment_idx" ON "payment_events" ("payment_id");--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_reference_uq" ON "payments" ("provider_code","provider_reference");--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_collected_by_users_id_fkey" FOREIGN KEY ("collected_by") REFERENCES "users"("id") ON DELETE RESTRICT;