CREATE TABLE "booking_items" (
	"id" serial PRIMARY KEY,
	"booking_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"schedule_slot_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"fee_centavos" integer NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY,
	"reference_number" text NOT NULL UNIQUE,
	"client_id" text NOT NULL,
	"status" text NOT NULL,
	"kind" text DEFAULT 'regular' NOT NULL,
	"total_centavos" integer NOT NULL,
	"hold_expires_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "booking_items_booking_idx" ON "booking_items" ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_items_slot_idx" ON "booking_items" ("schedule_slot_id");--> statement-breakpoint
CREATE INDEX "bookings_client_status_idx" ON "bookings" ("client_id","status");--> statement-breakpoint
CREATE INDEX "bookings_status_hold_idx" ON "bookings" ("status","hold_expires_at");--> statement-breakpoint
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_service_id_services_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_schedule_slot_id_schedule_slots_id_fkey" FOREIGN KEY ("schedule_slot_id") REFERENCES "schedule_slots"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_location_id_locations_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_users_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT;