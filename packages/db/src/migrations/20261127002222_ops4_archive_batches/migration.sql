CREATE TABLE "archive_batches" (
	"id" serial PRIMARY KEY,
	"data_class" text NOT NULL,
	"range_from" timestamp NOT NULL,
	"range_to" timestamp NOT NULL,
	"first_id" integer NOT NULL,
	"last_id" integer NOT NULL,
	"row_count" integer NOT NULL,
	"storage_key" text NOT NULL UNIQUE,
	"checksum" text NOT NULL,
	"chain_tail_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "archive_batches_class_range_idx" ON "archive_batches" ("data_class","range_from","range_to");