CREATE TABLE "service_categories" (
	"id" serial PRIMARY KEY,
	"code" text NOT NULL UNIQUE,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" serial PRIMARY KEY,
	"service_category_id" integer NOT NULL,
	"name" text NOT NULL,
	"fee_centavos" integer NOT NULL,
	"requires_head_approval" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "services_category_name_idx" ON "services" ("service_category_id","name");--> statement-breakpoint
CREATE INDEX "services_category_active_idx" ON "services" ("service_category_id","is_active");--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_service_category_id_service_categories_id_fkey" FOREIGN KEY ("service_category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT;
--> statement-breakpoint
INSERT INTO "service_categories" ("code", "name") VALUES
	('immunization', 'Immunization'),
	('physical-exam', 'Physical Examination'),
	('sanitation', 'Sanitation'),
	('food-safety', 'Food Safety'),
	('human-remains-bio', 'Human Remains and Biological Substance'),
	('food-export-water', 'Food Export and Water Testing'),
	('cashier', 'Cashier'),
	('rco', 'RCO');