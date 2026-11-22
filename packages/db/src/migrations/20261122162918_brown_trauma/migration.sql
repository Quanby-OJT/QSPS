CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"template" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text NOT NULL UNIQUE,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "notifications" ("channel","status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;