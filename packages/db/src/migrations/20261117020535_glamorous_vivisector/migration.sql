CREATE TABLE "locations" (
	"id" serial PRIMARY KEY,
	"code" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"region" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
