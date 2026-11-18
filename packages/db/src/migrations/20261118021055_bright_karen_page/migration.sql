CREATE TABLE "receipts" (
	"id" serial PRIMARY KEY,
	"payment_id" integer NOT NULL UNIQUE,
	"receipt_number" text NOT NULL UNIQUE,
	"verification_token" text NOT NULL UNIQUE,
	"issued_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_payments_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT;