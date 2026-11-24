-- Custom SQL migration file, put your code below! --
-- Custom SQL migration file, put your code below! --
-- CRT-5: the two sanitation Services and their questionnaires.
-- The Services are seeded switched off with no fee, so nothing goes live by
-- itself: an admin sets the real fee and switches them on (ADM-5).
-- auto_issue is false on purpose: an officer reviews the inspection, then
-- issues the document and enters its validity dates (and, for a ship, the
-- inspection findings). The questionnaires are a starting point that an admin
-- can edit with the form builder (FRM-1), but the question wording is what
-- the Sanitary Permit and the Ship Sanitation Certificate are built from, so
-- keep it (see sanitary-permit.ts and ship-sanitation.ts in the backend).
-- Insert-only and safe to re-run: it adds nothing to a Service that already
-- has a questionnaire.
INSERT INTO "services" ("service_category_id", "code", "name", "fee_centavos", "is_active", "document_type", "auto_issue")
SELECT "c"."id", "v"."code", "v"."name", 0, false, "v"."document_type", false
FROM "service_categories" AS "c"
CROSS JOIN (VALUES
	('SANITARY-PERMIT', 'Sanitary Permit', 'sanitary-permit'),
	('SHIP-SANITATION', 'Ship Sanitation Certificate', 'ship-sanitation')
) AS "v"("code", "name", "document_type")
WHERE "c"."code" = 'sanitation'
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "form_templates" ("service_id", "version", "status", "is_active", "published_at")
SELECT "id", 1, 'published', true, now()
FROM "services"
WHERE "code" IN ('SANITARY-PERMIT', 'SHIP-SANITATION')
	AND NOT EXISTS (
		SELECT 1 FROM "form_templates" WHERE "form_templates"."service_id" = "services"."id"
	);--> statement-breakpoint
INSERT INTO "form_fields" ("form_template_id", "type", "label", "required", "options", "position")
SELECT "t"."id", "v"."type", "v"."label", "v"."required", NULL::jsonb, "v"."position"
FROM "form_templates" AS "t"
INNER JOIN "services" AS "s" ON "s"."id" = "t"."service_id"
INNER JOIN (VALUES
	('SANITARY-PERMIT', 0, 'text', 'Establishment name', true),
	('SANITARY-PERMIT', 1, 'text', 'Type of establishment', true),
	('SANITARY-PERMIT', 2, 'text', 'Owner or operator', true),
	('SANITARY-PERMIT', 3, 'text', 'Business address', true),
	('SANITARY-PERMIT', 4, 'text', 'Contact number', false),
	('SHIP-SANITATION', 0, 'text', 'Vessel name', true),
	('SHIP-SANITATION', 1, 'text', 'Type of vessel', false),
	('SHIP-SANITATION', 2, 'text', 'Registry or IMO number', true),
	('SHIP-SANITATION', 3, 'text', 'Flag or port of registry', true),
	('SHIP-SANITATION', 4, 'text', 'Gross tonnage', false),
	('SHIP-SANITATION', 5, 'text', 'Master or agent', false),
	('SHIP-SANITATION', 6, 'text', 'Last port of call', false)
) AS "v"("service_code", "position", "type", "label", "required") ON "v"."service_code" = "s"."code"
WHERE "t"."version" = 1
	AND NOT EXISTS (
		SELECT 1 FROM "form_fields" AS "f" WHERE "f"."form_template_id" = "t"."id"
	);