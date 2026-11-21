import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common"

import { setAuthEventListener, type AuthEvent } from "@repo/auth/auth-events"

import { AuditService, type AuditEvent } from "./audit.service"

/** Audit domain for sign-up, verification, sign-in and MFA events (AUTH-1, AUTH-2). */
export const AUDIT_DOMAIN_AUTH = "auth"

/**
 * Records Better Auth's account events in the audit trail.
 *
 * The auth package cannot reach `AuditService`, so it calls the listener this
 * provider registers at startup (the same late binding as the rate-limit
 * storage). Only `AuditService.record` writes the row, as DOMAIN-MODEL §6
 * requires. Each event is attributed to the account it concerns; IP address,
 * device and role come from `AuditService` itself (FND-3).
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
		await this.auditService.record(toAuditEvent(event))
	}
}

/**
 * Map an auth event to an audit entry. Failed, locked and refused MFA
 * attempts are recorded as `denied`: a refusal is evidence (DOMAIN-MODEL §2).
 */
export function toAuditEvent(event: AuthEvent): AuditEvent {
	const base = {
		domain: AUDIT_DOMAIN_AUTH,
		action: event.type,
		actorId: event.userId,
		targetType: "user",
		targetId: event.userId,
	}

	switch (event.type) {
		case "mfa.verified":
			return { ...base, newValue: { method: event.method } }
		case "mfa.failed":
			return {
				...base,
				outcome: "denied",
				newValue: { method: event.method },
				reason: "wrong code",
			}
		case "mfa.locked":
			return {
				...base,
				outcome: "denied",
				newValue: { method: event.method },
				reason: "challenge locked after repeated wrong codes",
			}
		case "mfa.refused":
			return { ...base, outcome: "denied", reason: event.reason }
		default:
			return base
	}
}
