CREATE TABLE "service_categories" (
	"id" serial PRIMARY KEY,
	"code" text NOT NULL UNIQUE,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" serial PRIMARY KEY,
	"service_category_id" integer NOT NULL,
	"code" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"fee_centavos" integer NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"document_type" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "services_category_name_idx" ON "services" ("service_category_id","name");--> statement-breakpoint
CREATE INDEX "services_category_active_idx" ON "services" ("service_category_id","is_active");--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_service_category_id_service_categories_id_fkey" FOREIGN KEY ("service_category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT;