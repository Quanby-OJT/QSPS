-- ADM-5: the eight Service Category codes from the DOMAIN-MODEL glossary.
-- Insert-only and safe to re-run.
INSERT INTO "service_categories" ("code", "name") VALUES
	('immunization', 'Immunization'),
	('physical-exam', 'Physical Examination'),
	('sanitation', 'Sanitation'),
	('food-safety', 'Food Safety'),
	('human-remains-bio', 'Human Remains and Biological Substance'),
	('food-export-water', 'Food Export and Water Testing'),
	('cashier', 'Cashier'),
	('rco', 'RCO')
ON CONFLICT ("code") DO NOTHING;