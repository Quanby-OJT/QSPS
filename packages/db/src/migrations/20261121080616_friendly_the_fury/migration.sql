CREATE INDEX "audit_log_domain_action_idx" ON "audit_log" ("domain","action","id");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" ("target_type","target_id","id");--> statement-breakpoint
CREATE INDEX "audit_log_denied_idx" ON "audit_log" ("id") WHERE "outcome" = 'denied';