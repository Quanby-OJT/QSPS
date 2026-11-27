-- OPS-4: the retention job is the one exception to the FND-3 append-only rule.
-- It deletes archived audit entries under this no-login role, inside its own
-- transaction (SET LOCAL ROLE). UPDATE and TRUNCATE stay refused for every role.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qsps_archiver') THEN
        CREATE ROLE qsps_archiver NOLOGIN;
    END IF;
    GRANT SELECT, DELETE ON audit_log, notifications, payment_events TO qsps_archiver;
    EXECUTE format('GRANT qsps_archiver TO %I', current_user);
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'qsps_archiver could not be set up (%); audit archiving stays off until a database owner runs this migration', SQLERRM;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_log_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_user = 'qsps_archiver' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;