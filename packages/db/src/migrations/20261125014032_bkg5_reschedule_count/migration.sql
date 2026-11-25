ALTER TABLE "booking_items" ADD COLUMN "reschedule_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "booking_items_status_idx" ON "booking_items" ("status");--> statement-breakpoint
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_fee_nonnegative_chk" CHECK ("fee_centavos" >= 0);--> statement-breakpoint
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_reschedule_count_nonnegative_chk" CHECK ("reschedule_count" >= 0);