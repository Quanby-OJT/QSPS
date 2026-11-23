CREATE TABLE "form_fields" (
	"id" serial PRIMARY KEY,
	"form_template_id" integer NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"options" jsonb,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" serial PRIMARY KEY,
	"booking_item_id" integer NOT NULL,
	"form_template_id" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_templates" (
	"id" serial PRIMARY KEY,
	"service_id" integer NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "form_fields_template_position_uq" ON "form_fields" ("form_template_id","position");--> statement-breakpoint
CREATE INDEX "form_submissions_template_idx" ON "form_submissions" ("form_template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_submissions_booking_item_uq" ON "form_submissions" ("booking_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_templates_service_version_uq" ON "form_templates" ("service_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "form_templates_one_draft_per_service_uq" ON "form_templates" ("service_id") WHERE "status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "form_templates_one_published_per_service_uq" ON "form_templates" ("service_id") WHERE "status" = 'published';--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_template_id_form_templates_id_fkey" FOREIGN KEY ("form_template_id") REFERENCES "form_templates"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_booking_item_id_booking_items_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_template_id_form_templates_id_fkey" FOREIGN KEY ("form_template_id") REFERENCES "form_templates"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_service_id_services_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT;