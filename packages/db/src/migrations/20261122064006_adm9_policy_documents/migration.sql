CREATE TABLE "policy_acceptances" (
	"id" serial PRIMARY KEY,
	"booking_id" integer NOT NULL,
	"policy_document_id" integer NOT NULL,
	"client_id" text NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_documents" (
	"id" serial PRIMARY KEY,
	"document_key" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"applies_to_all_services" boolean DEFAULT false NOT NULL,
	"service_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"effective_from" date NOT NULL,
	"requires_acceptance" boolean DEFAULT true NOT NULL,
	"withdrawn_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "policy_acceptances_booking_document_uq" ON "policy_acceptances" ("booking_id","policy_document_id");--> statement-breakpoint
CREATE INDEX "policy_acceptances_document_idx" ON "policy_acceptances" ("policy_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_documents_key_version_uq" ON "policy_documents" ("document_key","version");--> statement-breakpoint
CREATE INDEX "policy_documents_effective_idx" ON "policy_documents" ("effective_from");--> statement-breakpoint
ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_policy_document_id_policy_documents_id_fkey" FOREIGN KEY ("policy_document_id") REFERENCES "policy_documents"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_client_id_users_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT;