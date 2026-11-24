import { randomUUID } from "node:crypto"
import { Injectable, Logger } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm"

import type {
	Booking,
	CreateWalkInBookingInput,
	CreateWalkInClientInput,
	WalkInClient,
	WalkInSlots,
} from "@repo/contracts"
import {
	locations,
	roles,
	scheduleSlots,
	services,
	userRoles,
	users,
	userScopes,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { inScope, NATIONWIDE_SCOPE, type ResolvedScope } from "@/common/scope/scope-match"

import { BookingService } from "../bookings/bookings.service"
import { manilaDateOf, manilaDateTimeToUtc } from "../schedules/manila-time"

const AUDIT_DOMAIN_BOOKINGS = "bookings"
const CLIENT_ROLE = "Client"
/** Same limit as MAX_WALK_IN_LOOKUP_RESULTS in @repo/contracts (backend Jest cannot load its runtime exports). */
const MAX_LOOKUP_RESULTS = 10
const MS_PER_DAY = 86_400_000

const logger = new Logger("WalkInService")

type UserRow = typeof users.$inferSelect

/** The last ten digits of a mobile number, so 0917…, 917… and +63917… match. Null when too short. */
export function mobileKey(mobile: string): string | null {
	const digits = mobile.replace(/\D/g, "")
	return digits.length >= 10 ? digits.slice(-10) : null
}

/** Emails compare without case: an address typed in capitals is the same account. */
function emailIs(email: string) {
	return sql`lower(${users.email}) = ${email.trim().toLowerCase()}`
}

/** The same comparison in SQL, on the stored number. */
function storedMobileKey() {
	return sql<string>`right(regexp_replace(coalesce(${users.mobile}, ''), '[^0-9]', '', 'g'), 10)`
}

function toClient(row: UserRow): WalkInClient {
	return {
		id: row.id,
		name: row.name,
		email: row.email,
		mobile: row.mobile ?? null,
		birthDate: row.birthDate ?? null,
		nationality: row.nationality ?? null,
		gender: row.gender ?? null,
		invitationPending: row.mustResetPassword,
	}
}

function requireActor(actorId: string | null): string {
	if (!actorId) throw new ORPCError("UNAUTHORIZED", { message: "Sign in to encode walk-ins" })
	return actorId
}

/** The same answer for "not there" and "not here", so other Locations cannot be probed. */
function slotNotHere() {
	return new ORPCError("NOT_FOUND", { message: "Schedule slot not found at your location" })
}

/**
 * Walk-in clients (PRC-2, Annex A): a Processing Officer encodes a client who
 * came to the office and books them into today's schedule at the officer's
 * Location. TOR §VIII.2 forbids guest transactions, so the client always has
 * an account.
 *
 * A new account is created without a password and flagged
 * `must_reset_password`; the client sets the password from the emailed
 * invitation, the same Better Auth link staff accounts get (ADM-1), so staff
 * never set credentials. The Booking itself goes through
 * `BookingService.create`, which owns every booking rule.
 */
@Injectable()
export class WalkInService {
	constructor(
		private readonly bookingService: BookingService,
		private readonly auditService: AuditService
	) {}

	/** Client accounts with this exact email address or mobile number. */
	async lookup(query: string): Promise<WalkInClient[]> {
		const text = query.trim()
		const byEmail = text.includes("@")
		const key = byEmail ? null : mobileKey(text)
		if (!byEmail && !key) return []

		const rows = await db
			.select()
			.from(users)
			.where(
				and(
					eq(users.accountType, "client"),
					isNull(users.deletedAt),
					isNull(users.disabledAt),
					byEmail ? emailIs(text) : sql`${storedMobileKey()} = ${key}`
				)
			)
			.orderBy(asc(users.name))
			.limit(MAX_LOOKUP_RESULTS)
		return rows.map(toClient)
	}

	/**
	 * Create a client account for a walk-in and send the invitation. Refused
	 * with 409 when an account already has this email or mobile, so no
	 * duplicate is created; the error data names it so staff can select it.
	 */
	async createClient(
		input: CreateWalkInClientInput,
		actorId: string | null,
		now: Date = new Date()
	): Promise<WalkInClient> {
		const staffId = requireActor(actorId)
		const email = input.email.trim().toLowerCase()
		const key = input.mobile ? mobileKey(input.mobile) : null

		const created = await db.transaction(async tx => {
			const [existing] = await tx
				.select({ id: users.id, email: users.email, accountType: users.accountType })
				.from(users)
				.where(or(emailIs(email), ...(key ? [sql`${storedMobileKey()} = ${key}`] : [])))
				.limit(1)
			if (existing) {
				const sameEmail = existing.email.toLowerCase() === email
				throw new ORPCError("CONFLICT", {
					message:
						existing.accountType === "client"
							? `An account already has this ${sameEmail ? "email address" : "mobile number"}. Find the client and select them instead.`
							: `This ${sameEmail ? "email address" : "mobile number"} belongs to a staff account. Use another one for the client.`,
					data:
						existing.accountType === "client"
							? { clientId: existing.id, matchedBy: sameEmail ? "email" : "mobile" }
							: {},
				})
			}

			const [clientRole] = await tx
				.select({ id: roles.id })
				.from(roles)
				.where(eq(roles.name, CLIENT_ROLE))
				.limit(1)
			if (!clientRole) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The Client role is missing" })
			}

			const [inserted] = await tx
				.insert(users)
				.values({
					id: randomUUID(),
					name: input.name.trim(),
					email,
					// The set-password link goes to this address, so using it proves the client owns it.
					emailVerified: true,
					accountType: "client",
					mustResetPassword: true,
					mobile: input.mobile ?? null,
					birthDate: input.birthDate,
					nationality: input.nationality,
					gender: input.gender,
					createdAt: now,
					updatedAt: now,
				})
				.returning()
			if (!inserted) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "The account could not be created",
				})
			}
			await tx.insert(userRoles).values({ userId: inserted.id, roleId: clientRole.id })

			// No personal data (name, email, mobile, birth date) in audit values.
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_BOOKINGS,
					action: "walk_in.client.create",
					actorId: staffId,
					targetType: "user",
					targetId: inserted.id,
					oldValue: null,
					newValue: {
						accountType: "client",
						mustResetPassword: true,
						roles: [CLIENT_ROLE],
						hasMobile: inserted.mobile !== null,
					},
				},
				tx
			)
			return inserted
		})

		await this.sendInvitation(created.email)
		return toClient(created)
	}

	/** Today's slots for a Service at the officer's Location that have not ended. */
	async slots(
		serviceId: number,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE,
		now: Date = new Date()
	): Promise<WalkInSlots> {
		const staffId = requireActor(actorId)
		const date = manilaDateOf(now)
		const location = await this.staffLocation(staffId)
		if (!location) return { location: null, date, slots: [] }

		const [service] = await db
			.select({ serviceCategoryId: services.serviceCategoryId })
			.from(services)
			.where(eq(services.id, serviceId))
			.limit(1)
		if (
			!service ||
			!inScope(scope, { serviceCategoryId: service.serviceCategoryId, locationId: location.id })
		) {
			return { location, date, slots: [] }
		}

		const dayStart = manilaDateTimeToUtc(date, "00:00")
		const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY)
		const rows = await db
			.select()
			.from(scheduleSlots)
			.where(
				and(
					eq(scheduleSlots.serviceId, serviceId),
					eq(scheduleSlots.locationId, location.id),
					eq(scheduleSlots.isDisabled, false),
					gt(scheduleSlots.endsAt, now),
					gte(scheduleSlots.startsAt, dayStart),
					lt(scheduleSlots.startsAt, dayEnd)
				)
			)
			.orderBy(asc(scheduleSlots.startsAt))
		return {
			location,
			date,
			slots: rows.map(slot => ({
				id: slot.id,
				startsAt: slot.startsAt,
				endsAt: slot.endsAt,
				capacity: slot.capacity,
				bookedCount: slot.bookedCount,
				remaining: Math.max(0, slot.capacity - slot.bookedCount),
				inProgress: slot.startsAt.getTime() <= now.getTime(),
			})),
		}
	}

	/**
	 * Book a walk-in client into today's slots at the officer's Location.
	 * A slot elsewhere, or outside the officer's Scope, answers 404 and the
	 * attempt is audited as denied. Everything else (capacity, the one unpaid
	 * booking, the questionnaire, policies) is `BookingService.create`'s.
	 */
	async createBooking(
		input: CreateWalkInBookingInput,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE,
		now: Date = new Date()
	): Promise<Booking> {
		const staffId = requireActor(actorId)
		const location = await this.staffLocation(staffId)
		if (!location) {
			await this.recordDenial(staffId, "client", input.clientId, "no_location")
			throw slotNotHere()
		}

		const [client] = await db
			.select({ id: users.id })
			.from(users)
			.where(
				and(
					eq(users.id, input.clientId),
					eq(users.accountType, "client"),
					isNull(users.deletedAt),
					isNull(users.disabledAt)
				)
			)
			.limit(1)
		if (!client) throw new ORPCError("NOT_FOUND", { message: "Client not found" })

		const slotIds = input.items.map(item => item.scheduleSlotId)
		const slotRows = await db
			.select({
				id: scheduleSlots.id,
				locationId: scheduleSlots.locationId,
				startsAt: scheduleSlots.startsAt,
				serviceCategoryId: services.serviceCategoryId,
			})
			.from(scheduleSlots)
			.innerJoin(services, eq(services.id, scheduleSlots.serviceId))
			.where(inArray(scheduleSlots.id, slotIds))
		const today = manilaDateOf(now)
		for (const slotId of slotIds) {
			const slot = slotRows.find(row => row.id === slotId)
			if (
				!slot ||
				slot.locationId !== location.id ||
				!inScope(scope, { serviceCategoryId: slot.serviceCategoryId, locationId: slot.locationId })
			) {
				if (slot) await this.recordDenial(staffId, "schedule_slot", slotId, "outside_scope")
				throw slotNotHere()
			}
			if (manilaDateOf(slot.startsAt) !== today) {
				throw new ORPCError("CONFLICT", {
					message: "Walk-ins are booked into today's schedule. Choose one of today's slots.",
					data: { scheduleSlotId: slotId },
				})
			}
		}

		return this.bookingService.create(input, staffId, now, {
			clientId: client.id,
			locationId: location.id,
		})
	}

	/**
	 * The staff user's Location from `user_scopes`, as for check-in (PRC-1):
	 * the first scope row that names a Location, or null.
	 */
	private async staffLocation(staffId: string): Promise<{ id: number; name: string } | null> {
		const [row] = await db
			.select({ id: locations.id, name: locations.name })
			.from(userScopes)
			.innerJoin(locations, eq(locations.id, userScopes.locationId))
			.where(eq(userScopes.userId, staffId))
			.orderBy(asc(userScopes.id))
			.limit(1)
		return row ?? null
	}

	/** Recorded outside any transaction, so the denial is kept when the request fails. */
	private async recordDenial(
		staffId: string,
		targetType: "client" | "schedule_slot",
		targetId: string | number,
		reason: "outside_scope" | "no_location"
	): Promise<void> {
		await this.auditService.record({
			domain: AUDIT_DOMAIN_BOOKINGS,
			action: "booking.walk_in.create",
			outcome: "denied",
			actorId: staffId,
			targetType,
			targetId: String(targetId),
			reason,
		})
	}

	/**
	 * The invitation: Better Auth's set-password email, as for new staff
	 * (ADM-1). Completing it clears `must_reset_password`. A delivery failure
	 * is logged, not thrown: the account is created and the client can use
	 * "Forgot password" with the same address.
	 */
	private async sendInvitation(email: string): Promise<void> {
		try {
			const { authEnv, getAuth } = await import("@repo/auth")
			await getAuth().api.requestPasswordReset({
				body: { email, redirectTo: `${authEnv.APP_WEB_URL}/reset-password` },
			})
		} catch (error) {
			logger.warn({
				event: "walk_in.invitation_failed",
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}
}
