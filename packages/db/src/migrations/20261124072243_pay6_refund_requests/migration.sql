CREATE TABLE "refund_requests" (
	"id" serial PRIMARY KEY,
	"booking_id" integer NOT NULL,
	"payment_id" integer,
	"kind" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text NOT NULL,
	"requested_by" text NOT NULL,
	"decided_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "review_resolution" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "rebooked_booking_id" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
CREATE INDEX "payments_status_updated_idx" ON "payments" ("status","updated_at");--> statement-breakpoint
CREATE INDEX "refund_requests_booking_idx" ON "refund_requests" ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_requests_payment_open_uq" ON "refund_requests" ("payment_id") WHERE "status" in ('requested', 'approved');--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_rebooked_booking_id_bookings_id_fkey" FOREIGN KEY ("rebooked_booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reviewed_by_users_id_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_payment_id_payments_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_requested_by_users_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_decided_by_users_id_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT;