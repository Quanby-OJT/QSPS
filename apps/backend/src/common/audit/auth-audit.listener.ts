import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common"

import { setAuthEventListener, type AuthEvent } from "@repo/auth/auth-events"

import { AuditService } from "./audit.service"

/** Audit domain for sign-up, verification and sign-in events (AUTH-1). */
export const AUDIT_DOMAIN_AUTH = "auth"

/**
 * Records Better Auth's account events in the audit trail.
 *
 * The auth package cannot reach `AuditService`, so it calls the listener this
 * provider registers at startup (the same late binding as the rate-limit
 * storage). Only `AuditService.record` writes the row, as DOMAIN-MODEL §6
 * requires. Each event is attributed to the account it concerns.
 */
@Injectable()
export class AuthAuditListener implements OnModuleInit, OnModuleDestroy {
	constructor(private readonly auditService: AuditService) {}

	onModuleInit(): void {
		setAuthEventListener(event => this.record(event))
	}

	onModuleDestroy(): void {
		setAuthEventListener(null)
	}

	async record(event: AuthEvent): Promise<void> {
		await this.auditService.record({
			domain: AUDIT_DOMAIN_AUTH,
			action: event.type,
			actorId: event.userId,
			targetType: "user",
			targetId: event.userId,
		})
	}
}
