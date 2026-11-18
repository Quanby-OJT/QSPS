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
CREATE TABLE "user_scopes" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"service_category_id" integer,
	"location_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "assessments_booking_item_idx" ON "assessments" ("booking_item_id","created_at");--> statement-breakpoint
CREATE INDEX "user_scopes_user_idx" ON "user_scopes" ("user_id");--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_booking_item_id_booking_items_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_staff_id_users_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_service_category_id_service_categories_id_fkey" FOREIGN KEY ("service_category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_location_id_locations_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT;