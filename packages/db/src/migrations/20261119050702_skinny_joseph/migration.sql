CREATE TABLE "document_sequences" (
	"id" serial PRIMARY KEY,
	"document_type" text NOT NULL,
	"location_id" integer NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY,
	"booking_item_id" integer,
	"document_type" text NOT NULL,
	"document_number" text NOT NULL,
	"verification_token" text NOT NULL UNIQUE,
	"issuing_location_id" integer NOT NULL,
	"issued_by" text,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"valid_until" date,
	"status" text DEFAULT 'valid' NOT NULL,
	"source" text DEFAULT 'qsps' NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "auto_issue" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "document_sequences_type_location_uq" ON "document_sequences" ("document_type","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_type_number_uq" ON "documents" ("document_type","document_number");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_booking_item_valid_uq" ON "documents" ("booking_item_id") WHERE "status" = 'valid';--> statement-breakpoint
CREATE INDEX "documents_issuing_location_idx" ON "documents" ("issuing_location_id");--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_location_id_locations_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_booking_item_id_booking_items_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_issuing_location_id_locations_id_fkey" FOREIGN KEY ("issuing_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_issued_by_users_id_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE RESTRICT;