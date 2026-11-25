CREATE TABLE "service_steps" (
	"id" serial PRIMARY KEY,
	"service_id" integer NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_results" (
	"id" serial PRIMARY KEY,
	"booking_item_id" integer NOT NULL,
	"service_step_id" integer NOT NULL,
	"form_template_id" integer NOT NULL,
	"version" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_templates" ADD COLUMN "purpose" text DEFAULT 'questionnaire' NOT NULL;--> statement-breakpoint
ALTER TABLE "form_templates" ADD COLUMN "service_step_id" integer;--> statement-breakpoint
DROP INDEX "form_templates_service_version_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "form_templates_service_version_uq" ON "form_templates" ("service_id","version") WHERE "purpose" = 'questionnaire';--> statement-breakpoint
DROP INDEX "form_templates_one_draft_per_service_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "form_templates_one_draft_per_service_uq" ON "form_templates" ("service_id") WHERE "status" = 'draft' and "purpose" = 'questionnaire';--> statement-breakpoint
DROP INDEX "form_templates_one_published_per_service_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "form_templates_one_published_per_service_uq" ON "form_templates" ("service_id") WHERE "status" = 'published' and "purpose" = 'questionnaire';--> statement-breakpoint
CREATE UNIQUE INDEX "form_templates_step_version_uq" ON "form_templates" ("service_step_id","version") WHERE "service_step_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "form_templates_one_published_per_step_uq" ON "form_templates" ("service_step_id") WHERE "status" = 'published' and "service_step_id" is not null;--> statement-breakpoint
CREATE INDEX "service_steps_service_idx" ON "service_steps" ("service_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "step_results_item_step_version_uq" ON "step_results" ("booking_item_id","service_step_id","version");--> statement-breakpoint
CREATE INDEX "step_results_step_idx" ON "step_results" ("service_step_id");--> statement-breakpoint
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_service_step_id_service_steps_id_fkey" FOREIGN KEY ("service_step_id") REFERENCES "service_steps"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "service_steps" ADD CONSTRAINT "service_steps_service_id_services_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "step_results" ADD CONSTRAINT "step_results_booking_item_id_booking_items_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "step_results" ADD CONSTRAINT "step_results_service_step_id_service_steps_id_fkey" FOREIGN KEY ("service_step_id") REFERENCES "service_steps"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "step_results" ADD CONSTRAINT "step_results_form_template_id_form_templates_id_fkey" FOREIGN KEY ("form_template_id") REFERENCES "form_templates"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "step_results" ADD CONSTRAINT "step_results_recorded_by_users_id_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT;