ALTER TABLE "audit_log" ADD COLUMN "actor_role" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "ip_address" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "entry_hash" text;