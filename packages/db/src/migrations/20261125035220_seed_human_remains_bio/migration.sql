-- Custom SQL migration file, put your code below! --
-- CRT-7: human remains transport and biological substance clearance, with their questionnaires.
-- The Services are seeded switched off with no fee, so nothing goes live by
-- itself: an admin sets the real fee and switches them on (ADM-5).
-- auto_issue is false on purpose: an officer issues each document from the
-- cleared item (certificates.documents:issue), and the Biological Substance
-- Permit also needs the validity dates the officer enters there. The
-- questionnaires are a starting point that an admin can edit with the form
-- builder (FRM-1), but the question wording is what the documents are built
-- from, so keep it (see human-remains.ts and biological-substance.ts in the
-- backend). The answers are personal data, so the documents built from them are
-- stored encrypted (DOCUMENT_PAYLOAD_KEY).
-- Insert-only and safe to re-run: it adds nothing to a Service that already
-- has a questionnaire.
INSERT INTO "services" ("service_category_id", "code", "name", "fee_centavos", "is_active", "document_type", "auto_issue")
SELECT "c"."id", "v"."code", "v"."name", 0, false, "v"."document_type", false
FROM "service_categories" AS "c"
CROSS JOIN (VALUES
	('HUMAN-REMAINS-TRANSPORT', 'Human Remains Transport Clearance', 'human-remains'),
	('BIOLOGICAL-CERTIFICATION', 'Biological Substance Certification', 'biological-certification'),
	('BIOLOGICAL-PERMIT', 'Biological Substance Permit', 'biological-permit')
) AS "v"("code", "name", "document_type")
WHERE "c"."code" = 'human-remains-bio'
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "form_templates" ("service_id", "version", "status", "is_active", "published_at")
SELECT "id", 1, 'published', true, now()
FROM "services"
WHERE "code" IN ('HUMAN-REMAINS-TRANSPORT', 'BIOLOGICAL-CERTIFICATION', 'BIOLOGICAL-PERMIT')
	AND NOT EXISTS (
		SELECT 1 FROM "form_templates" WHERE "form_templates"."service_id" = "services"."id"
	);--> statement-breakpoint
INSERT INTO "form_fields" ("form_template_id", "type", "label", "required", "options", "position")
SELECT "t"."id", "v"."type", "v"."label", "v"."required", NULL::jsonb, "v"."position"
FROM "form_templates" AS "t"
INNER JOIN "services" AS "s" ON "s"."id" = "t"."service_id"
INNER JOIN (VALUES
	('HUMAN-REMAINS-TRANSPORT', 0, 'text', 'Name of the deceased', true),
	('HUMAN-REMAINS-TRANSPORT', 1, 'text', 'Date of death', true),
	('HUMAN-REMAINS-TRANSPORT', 2, 'text', 'Cause of death', true),
	('HUMAN-REMAINS-TRANSPORT', 3, 'text', 'Embalmed or cremated', true),
	('HUMAN-REMAINS-TRANSPORT', 4, 'text', 'Consignee name', true),
	('HUMAN-REMAINS-TRANSPORT', 5, 'text', 'Consignee address', true),
	('HUMAN-REMAINS-TRANSPORT', 6, 'text', 'Consignee contact number', false),
	('HUMAN-REMAINS-TRANSPORT', 7, 'text', 'Origin', true),
	('HUMAN-REMAINS-TRANSPORT', 8, 'text', 'Destination', true),
	('HUMAN-REMAINS-TRANSPORT', 9, 'text', 'Carrier, flight or vessel', true),
	('HUMAN-REMAINS-TRANSPORT', 10, 'text', 'Date of transport', true),
	('BIOLOGICAL-CERTIFICATION', 0, 'text', 'Substance or specimen', true),
	('BIOLOGICAL-CERTIFICATION', 1, 'text', 'Quantity', true),
	('BIOLOGICAL-CERTIFICATION', 2, 'text', 'Origin', true),
	('BIOLOGICAL-CERTIFICATION', 3, 'text', 'Destination', true),
	('BIOLOGICAL-CERTIFICATION', 4, 'text', 'Sender or shipper', false),
	('BIOLOGICAL-CERTIFICATION', 5, 'text', 'Consignee', false),
	('BIOLOGICAL-CERTIFICATION', 6, 'text', 'Purpose', false),
	('BIOLOGICAL-PERMIT', 0, 'text', 'Substance or specimen', true),
	('BIOLOGICAL-PERMIT', 1, 'text', 'Quantity', true),
	('BIOLOGICAL-PERMIT', 2, 'text', 'Origin', true),
	('BIOLOGICAL-PERMIT', 3, 'text', 'Destination', true),
	('BIOLOGICAL-PERMIT', 4, 'text', 'Sender or shipper', false),
	('BIOLOGICAL-PERMIT', 5, 'text', 'Consignee', false),
	('BIOLOGICAL-PERMIT', 6, 'text', 'Purpose', false)
) AS "v"("service_code", "position", "type", "label", "required") ON "v"."service_code" = "s"."code"
WHERE "t"."version" = 1
	AND NOT EXISTS (
		SELECT 1 FROM "form_fields" AS "f" WHERE "f"."form_template_id" = "t"."id"
	);
