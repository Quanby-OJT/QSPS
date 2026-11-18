CREATE TABLE "assessments" (
	"id" serial PRIMARY KEY,
	"booking_item_id" integer NOT NULL,
	"staff_id" text NOT NULL,
	"outcome" text NOT NULL,
	"notes" text,
	"corrections" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "location_id" integer;--> statement-breakpoint
CREATE INDEX "assessments_booking_item_idx" ON "assessments" ("booking_item_id","created_at");--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_booking_item_id_booking_items_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_staff_id_users_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_location_id_locations_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT;