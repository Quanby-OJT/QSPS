-- ADM-1: accounts created before account_type existed default to 'client'.
-- Super Admin holders are BOQ staff, so AUTH-2's staff-only rules
-- (mandatory MFA) apply to them too.
UPDATE "users"
SET "account_type" = 'staff', "updated_at" = now()
WHERE "account_type" <> 'staff'
  AND "id" IN (
    SELECT ur."user_id"
    FROM "user_roles" ur
    JOIN "roles" r ON r."id" = ur."role_id"
    WHERE r."name" = 'Super Admin'
  );