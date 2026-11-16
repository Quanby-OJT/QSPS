ALTER TABLE "users" ADD COLUMN "account_type" text DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mobile" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "privacy_notice_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "privacy_accepted_at" timestamp;