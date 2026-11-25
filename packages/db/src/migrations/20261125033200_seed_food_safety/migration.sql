-- Custom SQL migration file, put your code below! --
-- CRT-6: the seminar and the GMP-HACCP audit, with their questionnaires.
-- The Services are seeded switched off with no fee, so nothing goes live by
-- itself: an admin sets the real fee, switches them on (ADM-5) and creates the
-- seminar sessions and audit slots in the Schedule (SCH-1).
-- auto_issue is false on purpose. The seminar's Food Safety Training
-- Certificate is issued from the session roster once attendance is marked, and
-- the HACCP Certificate by an officer who enters its validity dates after the
-- audit is cleared. The questionnaires are a starting point that an admin can
-- edit with the form builder (FRM-1), but the HACCP question wording is what
-- the certificate is built from, so keep it (see haccp.ts and
-- food-safety-training.ts in the backend).
-- Insert-only and safe to re-run: it adds nothing to a Service that already
-- has a questionnaire.
INSERT INTO "services" ("service_category_id", "code", "name", "fee_centavos", "is_active", "document_type", "auto_issue")
SELECT "c"."id", "v"."code", "v"."name", 0, false, "v"."document_type", false
FROM "service_categories" AS "c"
CROSS JOIN (VALUES
	('FOOD-SAFETY-SEMINAR', 'Basic Hygiene and Sanitation Seminar', 'food-safety-training'),
	('GMP-HACCP-AUDIT', 'GMP-HACCP Audit', 'haccp')
) AS "v"("code", "name", "document_type")
WHERE "c"."code" = 'food-safety'
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "form_templates" ("service_id", "version", "status", "is_active", "published_at")
SELECT "id", 1, 'published', true, now()
FROM "services"
WHERE "code" IN ('FOOD-SAFETY-SEMINAR', 'GMP-HACCP-AUDIT')
	AND NOT EXISTS (
		SELECT 1 FROM "form_templates" WHERE "form_templates"."service_id" = "services"."id"
	);--> statement-breakpoint
INSERT INTO "form_fields" ("form_template_id", "type", "label", "required", "options", "position")
SELECT "t"."id", "v"."type", "v"."label", "v"."required", NULL::jsonb, "v"."position"
FROM "form_templates" AS "t"
INNER JOIN "services" AS "s" ON "s"."id" = "t"."service_id"
INNER JOIN (VALUES
	('FOOD-SAFETY-SEMINAR', 0, 'text', 'Establishment or employer', false),
	('FOOD-SAFETY-SEMINAR', 1, 'text', 'Position or role', false),
	('GMP-HACCP-AUDIT', 0, 'text', 'Establishment name', true),
	('GMP-HACCP-AUDIT', 1, 'text', 'Products or processes to be audited', true),
	('GMP-HACCP-AUDIT', 2, 'text', 'Owner or operator', true),
	('GMP-HACCP-AUDIT', 3, 'text', 'Business address', true),
	('GMP-HACCP-AUDIT', 4, 'text', 'Contact number', false)
) AS "v"("service_code", "position", "type", "label", "required") ON "v"."service_code" = "s"."code"
WHERE "t"."version" = 1
	AND NOT EXISTS (
		SELECT 1 FROM "form_fields" AS "f" WHERE "f"."form_template_id" = "t"."id"
	);
