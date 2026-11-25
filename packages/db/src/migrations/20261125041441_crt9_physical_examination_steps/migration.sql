DO $$
DECLARE
    pe_service_id integer;
    step_row record;
    pe_step_id integer;
    pe_template_id integer;
BEGIN
    SELECT id
      INTO pe_service_id
      FROM services
     WHERE code = 'PHYSICAL-EXAM';

    IF pe_service_id IS NULL THEN
        RAISE EXCEPTION 'CRT-9 requires the CRT-4 PHYSICAL-EXAM Service';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM service_steps
         WHERE service_id = pe_service_id
    ) THEN
        RAISE EXCEPTION
            'CRT-9 found existing Physical Examination Steps. Review them before applying this seed.';
    END IF;

    UPDATE services
       SET document_type = 'pe-medical-certificate',
           auto_issue = true
     WHERE id = pe_service_id;

    FOR step_row IN
        SELECT *
          FROM (VALUES
            (0, 'Laboratory'),
            (1, 'X-ray'),
            (2, 'Physician evaluation')
          ) AS configured(position, name)
    LOOP
        INSERT INTO service_steps
            (service_id, name, position, required, is_active)
        VALUES
            (pe_service_id, step_row.name, step_row.position, true, true)
        RETURNING id INTO pe_step_id;

        INSERT INTO form_templates
            (service_id, service_step_id, purpose, version,
             status, is_active, published_at)
        VALUES
            (pe_service_id, pe_step_id, 'step_result', 1,
             'published', true, now())
        RETURNING id INTO pe_template_id;

        IF step_row.position = 0 THEN
            INSERT INTO form_fields
                (form_template_id, type, label, required, options, position)
            VALUES
                (pe_template_id, 'text', 'Laboratory tests', true, NULL, 0),
                (pe_template_id, 'text', 'Laboratory results', true, NULL, 1),
                (pe_template_id, 'text', 'Remarks', false, NULL, 2);
        ELSIF step_row.position = 1 THEN
            INSERT INTO form_fields
                (form_template_id, type, label, required, options, position)
            VALUES
                (pe_template_id, 'text', 'Findings', true, NULL, 0),
                (pe_template_id, 'text', 'Impression', true, NULL, 1);
        ELSE
            INSERT INTO form_fields
                (form_template_id, type, label, required, options, position)
            VALUES
                (pe_template_id, 'single_choice', 'Evaluation', true,
                 '["Fit", "Unfit", "Pending"]'::jsonb, 0);
        END IF;
    END LOOP;
END $$;