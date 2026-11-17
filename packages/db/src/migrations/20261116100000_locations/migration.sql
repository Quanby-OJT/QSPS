CREATE TABLE "locations" (
	"code" text PRIMARY KEY,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"region" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
