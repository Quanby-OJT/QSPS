CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY,
	"title" text NOT NULL,
	"media_url" text NOT NULL,
	"media_type" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;