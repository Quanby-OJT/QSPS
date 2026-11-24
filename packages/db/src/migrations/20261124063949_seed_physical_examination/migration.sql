-- Custom SQL migration file, put your code below! --
-- CRT-4: the Physical Examination Service and its questionnaire.
-- The Service is seeded switched off with no fee, so nothing goes live by
-- itself: an admin sets the real fee and switches it on (ADM-5). The
-- questionnaire is a starting point that an admin can edit with the form
-- builder (FRM-1). The first question, 'Applicant type', is what the Local and
-- Foreign application forms are chosen from, so keep its wording and answers.
-- Insert-only and safe to re-run: it adds nothing to a Service that already
-- has a questionnaire.
INSERT INTO "services" ("service_category_id", "code", "name", "fee_centavos", "is_active")
SELECT "id", 'PHYSICAL-EXAM', 'Physical Examination', 0, false
FROM "service_categories"
WHERE "code" = 'physical-exam'
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "form_templates" ("service_id", "version", "status", "is_active", "published_at")
SELECT "id", 1, 'published', true, now()
FROM "services"
WHERE "code" = 'PHYSICAL-EXAM'
	AND NOT EXISTS (
		SELECT 1 FROM "form_templates" WHERE "form_templates"."service_id" = "services"."id"
	);--> statement-breakpoint
INSERT INTO "form_fields" ("form_template_id", "type", "label", "required", "options", "position")
SELECT "t"."id", "v"."type", "v"."label", "v"."required", "v"."options", "v"."position"
FROM "form_templates" AS "t"
INNER JOIN "services" AS "s" ON "s"."id" = "t"."service_id"
CROSS JOIN (VALUES
	(0, 'single_choice', 'Applicant type', true, '["Local","Foreign"]'::jsonb),
	(1, 'text', 'Purpose of examination', true, NULL::jsonb),
	(2, 'text', 'Passport or ID number', false, NULL::jsonb),
	(3, 'text', 'Present address', true, NULL::jsonb)
) AS "v"("position", "type", "label", "required", "options")
WHERE "s"."code" = 'PHYSICAL-EXAM'
	AND "t"."version" = 1
	AND NOT EXISTS (
		SELECT 1 FROM "form_fields" AS "f" WHERE "f"."form_template_id" = "t"."id"
	);
