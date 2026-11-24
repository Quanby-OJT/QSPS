ALTER TABLE "documents" ADD COLUMN "superseded_by" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "status_changed_by" text;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_status_changed_by_users_id_fkey" FOREIGN KEY ("status_changed_by") REFERENCES "users"("id") ON DELETE RESTRICT;