-- PAY-2a: an e-Receipt keeps the client, channel and Service names as they
-- were at payment time. Added nullable, filled for the receipts that already
-- exist (with the names current now; the channel code when the channel has no
-- row), then made NOT NULL.
ALTER TABLE "receipts" ADD COLUMN "client_name" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "channel_name" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "service_lines" jsonb;--> statement-breakpoint
UPDATE "receipts" AS r SET
    "client_name" = u."name",
    "channel_name" = COALESCE(pc."name", p."channel_code"),
    "service_lines" = COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object('serviceName', s."name", 'feeCentavos', bi."fee_centavos")
            ORDER BY bi."id"
        )
        FROM "booking_items" AS bi
        INNER JOIN "services" AS s ON s."id" = bi."service_id"
        WHERE bi."booking_id" = b."id"
    ), '[]'::jsonb)
FROM "payments" AS p
INNER JOIN "bookings" AS b ON b."id" = p."booking_id"
INNER JOIN "users" AS u ON u."id" = b."client_id"
LEFT JOIN "payment_channels" AS pc ON pc."code" = p."channel_code"
WHERE p."id" = r."payment_id";--> statement-breakpoint
ALTER TABLE "receipts" ALTER COLUMN "client_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ALTER COLUMN "channel_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ALTER COLUMN "service_lines" SET NOT NULL;