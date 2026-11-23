CREATE TABLE "mobile_verification_challenges" (
	"user_id" text PRIMARY KEY,
	"mobile" text NOT NULL,
	"code_digest" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_code_limits" (
	"key" text PRIMARY KEY,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mobile_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sms_notifications_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_otp_channel" text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "mobile_verification_challenges" ADD CONSTRAINT "mobile_verification_challenges_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;