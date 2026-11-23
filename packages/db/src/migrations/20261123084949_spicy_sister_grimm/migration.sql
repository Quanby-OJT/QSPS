CREATE TABLE "payment_channels" (
	"code" text PRIMARY KEY,
	"name" text NOT NULL,
	"provider_code" text,
	"convenience_fee_centavos" integer DEFAULT 0 NOT NULL,
	"convenience_fee_bps" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
