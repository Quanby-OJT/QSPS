-- CRT-10: seed inactive services and their versioned forms.
DO $$
DECLARE
    category_id integer;
    food_id integer;
    water_id integer;
    laboratory_id integer;
    template_id integer;
BEGIN
    SELECT id INTO category_id
      FROM service_categories
     WHERE code = 'food-export-water';

    IF category_id IS NULL THEN
        RAISE EXCEPTION 'CRT-10 requires the food-export-water Service Category';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM services
         WHERE code IN ('FOOD-EXPORT', 'WATER-TESTING')
    ) THEN
        RAISE EXCEPTION
            'CRT-10 found an existing Service with a reserved code. Review it before seeding.';
    END IF;

    INSERT INTO services (
        service_category_id, code, name, fee_centavos,
        document_type, auto_issue, is_active
    )
    VALUES (
        category_id, 'FOOD-EXPORT', 'Food Export Certification', 0,
        'food-export-certificate', true, false
    )
    RETURNING id INTO food_id;

    INSERT INTO services (
        service_category_id, code, name, fee_centavos,
        document_type, auto_issue, is_active
    )
    VALUES (
        category_id, 'WATER-TESTING', 'Water Testing', 0,
        'water-analysis-certificate', true, false
    )
    RETURNING id INTO water_id;

    INSERT INTO form_templates (
        service_id, purpose, version, status, is_active, published_at
    )
    VALUES (food_id, 'questionnaire', 1, 'published', true, now())
    RETURNING id INTO template_id;

    INSERT INTO form_fields (form_template_id, type, label, required, position)
    VALUES
        (template_id, 'text', 'Exporter', true, 0),
        (template_id, 'text', 'Product', true, 1),
        (template_id, 'text', 'Quantity', true, 2),
        (template_id, 'text', 'Destination', true, 3),
        (template_id, 'date', 'Shipment date', true, 4);

    INSERT INTO form_templates (
        service_id, purpose, version, status, is_active, published_at
    )
    VALUES (water_id, 'questionnaire', 1, 'published', true, now())
    RETURNING id INTO template_id;

    INSERT INTO form_fields (form_template_id, type, label, required, position)
    VALUES
        (template_id, 'text', 'Vessel or establishment', true, 0),
        (template_id, 'text', 'Sampling location', true, 1),
        (template_id, 'text', 'Sample reference', false, 2);

    INSERT INTO service_steps (service_id, name, position, required, is_active)
    VALUES (water_id, 'Laboratory analysis', 0, true, true)
    RETURNING id INTO laboratory_id;

    INSERT INTO form_templates (
        service_id, service_step_id, purpose, version, status, is_active, published_at
    )
    VALUES (water_id, laboratory_id, 'step_result', 1, 'published', true, now())
    RETURNING id INTO template_id;

    INSERT INTO form_fields (form_template_id, type, label, required, position)
    VALUES (
        template_id,
        'text',
        'Parameters: Name | Result | Pass or Fail. Separate rows with semicolons.',
        true,
        0
    );
END $$;
