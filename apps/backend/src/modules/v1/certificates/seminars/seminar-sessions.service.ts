import { HttpException, Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm"

import type {
	BookingItemStatus,
	BookingStatus,
	SeminarAttendanceInput,
	SeminarAttendanceResult,
	SeminarAttendee,
	SeminarIssueInput,
	SeminarIssueResult,
	SeminarRoster,
	SeminarSession,
	SeminarSessionParam,
	SeminarSessions,
	SeminarSessionsRequest,
} from "@repo/contracts"
import {
	bookingItems,
	bookings,
	documents,
	locations,
	scheduleSlots,
	services,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import {
	inScope,
	NATIONWIDE_SCOPE,
	scopeCondition,
	type ResolvedScope,
} from "@/common/scope/scope-match"

import { BookingService, type Transaction } from "../../bookings/bookings.service"
import { missingRequiredSteps } from "../../processing/steps/item-steps"
import { manilaDateOf, manilaDateTimeToUtc } from "../../schedules/manila-time"
import { foodSafetyTraining } from "../document-types/registry"
import { DocumentService } from "../documents.service"

const AUDIT_DOMAIN_CERTIFICATES = "certificates"
const MS_PER_DAY = 86_400_000

/** The Document type a Service issues to be a seminar (CRT-6). */
const SEMINAR_DOCUMENT_TYPE = foodSafetyTraining.type

/** Bookings that still hold a seat in the session. Cancelled and refunded ones are left out. */
const LISTED_BOOKING_STATUSES: BookingStatus[] = ["pending_payment", "paid", "completed"]

/** Annex B: paid is `paid` or `completed`. */
const PAID_BOOKING_STATUSES: readonly BookingStatus[] = ["paid", "completed"]

/** Item statuses that mean the attendee was marked present. */
const PRESENT_ITEM_STATUSES: readonly BookingItemStatus[] = [
	"checked_in",
	"in_assessment",
	"cleared",
	"pending_head_approval",
	"issued",
]

/** The same answer for "not there" and "not yours", so other Locations cannot be probed. */
function sessionNotFound() {
	return new ORPCError("NOT_FOUND", { message: "Seminar session not found at your scope" })
}

function requireActor(actorId: string | null): string {
	if (!actorId) {
		throw new ORPCError("UNAUTHORIZED", { message: "Sign in to manage seminar sessions" })
	}
	return actorId
}

/**
 * The words to show staff when one attendee could not be handled, or null for
 * an error that is not about that attendee (a lost database connection, say),
 * which must fail the whole request.
 */
function reasonOf(error: unknown): string | null {
	if (error instanceof ORPCError || error instanceof HttpException) {
		return error.message
	}
	return null
}

interface SessionRow {
	scheduleSlotId: number
	serviceId: number
	serviceName: string
	serviceCategoryId: number
	documentType: string | null
	locationId: number
	locationName: string
	startsAt: Date
	endsAt: Date
	capacity: number
	bookedCount: number
}

interface AttendeeRow {
	scheduleSlotId: number
	bookingItemId: number
	bookingId: number
	referenceNumber: string
	clientName: string
	status: BookingItemStatus
	bookingStatus: BookingStatus
	documentNumber: string | null
}

function toAttendee(row: AttendeeRow): SeminarAttendee {
	return {
		bookingItemId: row.bookingItemId,
		referenceNumber: row.referenceNumber,
		clientName: row.clientName,
		status: row.status,
		paymentStatus: PAID_BOOKING_STATUSES.includes(row.bookingStatus) ? "paid" : "unpaid",
		documentNumber: row.documentNumber,
	}
}

function toSession(row: SessionRow, attendees: readonly AttendeeRow[]): SeminarSession {
	return {
		scheduleSlotId: row.scheduleSlotId,
		serviceId: row.serviceId,
		serviceName: row.serviceName,
		locationId: row.locationId,
		locationName: row.locationName,
		startsAt: row.startsAt,
		endsAt: row.endsAt,
		capacity: row.capacity,
		bookedCount: row.bookedCount,
		paidCount: attendees.filter(a => PAID_BOOKING_STATUSES.includes(a.bookingStatus)).length,
		presentCount: attendees.filter(a => PRESENT_ITEM_STATUSES.includes(a.status)).length,
		absentCount: attendees.filter(a => a.status === "no_show").length,
		issuedCount: attendees.filter(a => a.status === "issued").length,
	}
}

/**
 * Seminar sessions (CRT-6, TOR §VIII.3). A session is an ordinary Schedule
 * Slot of a Service that issues the Food Safety Training Certificate, so
 * clients book it and capacity works exactly as for any other slot. This
 * service adds the day's roster for staff: marking attendance in bulk and
 * issuing the certificates in bulk.
 *
 * It changes no table itself. Attendance moves each Booking Item through
 * `BookingService` (the only code that changes item status) and certificates
 * come from `DocumentService.issue`, one transaction per attendee, so one
 * attendee who cannot be handled never blocks the others.
 *
 * Every read and write is limited to the caller's Scope (ADM-2). A session
 * outside it answers 404, the same as one that does not exist, and the
 * attempt is audited as denied.
 */
@Injectable()
export class SeminarSessionService {
	constructor(
		private readonly auditService: AuditService,
		private readonly bookingService: BookingService,
		private readonly documentService: DocumentService
	) {}

	/** The seminar sessions of one Manila date inside the caller's Scope, earliest first. */
	async sessions(
		input: SeminarSessionsRequest,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE,
		now: Date = new Date()
	): Promise<SeminarSessions> {
		requireActor(actorId)
		const date = input.date ?? manilaDateOf(now)
		const dayStart = manilaDateTimeToUtc(date, "00:00")
		const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY)

		const rows: SessionRow[] = await db
			.select(this.sessionColumns())
			.from(scheduleSlots)
			.innerJoin(services, eq(services.id, scheduleSlots.serviceId))
			.innerJoin(locations, eq(locations.id, scheduleSlots.locationId))
			.where(
				and(
					eq(services.documentType, SEMINAR_DOCUMENT_TYPE),
					gte(scheduleSlots.startsAt, dayStart),
					lt(scheduleSlots.startsAt, dayEnd),
					scopeCondition(scope, {
						serviceCategoryId: services.serviceCategoryId,
						locationId: scheduleSlots.locationId,
					})
				)
			)
			.orderBy(asc(scheduleSlots.startsAt), asc(scheduleSlots.id))
		if (rows.length === 0) return { date, sessions: [] }

		const attendees = await this.attendeesOf(rows.map(row => row.scheduleSlotId))
		return {
			date,
			sessions: rows.map(row =>
				toSession(
					row,
					attendees.filter(a => a.scheduleSlotId === row.scheduleSlotId)
				)
			),
		}
	}

	/** One session with the clients booked into it. */
	async roster(
		input: SeminarSessionParam,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<SeminarRoster> {
		const staffId = requireActor(actorId)
		const session = await this.requireSession(
			input.scheduleSlotId,
			staffId,
			"seminar_session.read",
			scope
		)
		const attendees = await this.attendeesOf([session.scheduleSlotId])
		return { session: toSession(session, attendees), attendees: attendees.map(toAttendee) }
	}

	/**
	 * Mark attendees present or absent. Present: checked in, assessed and
	 * cleared through the same steps as processing, so every Audit Entry and
	 * required step still applies. Absent: `no_show`. Only paid Bookings can be
	 * marked (Annex B). Marking again changes nothing.
	 */
	async markAttendance(
		input: SeminarAttendanceInput,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE,
		now: Date = new Date()
	): Promise<SeminarAttendanceResult> {
		const staffId = requireActor(actorId)
		const session = await this.requireSession(
			input.scheduleSlotId,
			staffId,
			"seminar_session.attendance",
			scope
		)
		const roster = new Map(
			(await this.attendeesOf([session.scheduleSlotId])).map(row => [row.bookingItemId, row])
		)

		const wanted = [
			...input.present.map(id => ({ id, want: "present" as const })),
			...input.absent.map(id => ({ id, want: "absent" as const })),
		]
		const results: SeminarAttendanceResult["results"] = []
		const seen = new Set<number>()
		for (const { id, want } of wanted) {
			if (seen.has(id)) continue
			seen.add(id)
			const attendee = roster.get(id)
			if (!attendee) {
				results.push({
					bookingItemId: id,
					outcome: "not_found",
					message: "This attendee is not in this session",
				})
				continue
			}
			try {
				const marked = await db.transaction(tx => this.markOne(tx, attendee, want, staffId, now))
				results.push({ bookingItemId: id, ...marked })
			} catch (error) {
				const reason = reasonOf(error)
				if (reason === null) throw error
				results.push({ bookingItemId: id, outcome: "refused", message: reason })
			}
		}
		return { results }
	}

	/**
	 * Issue the Food Safety Training Certificate to the attendees marked
	 * present, or to the ones chosen. One `DocumentService.issue` call and one
	 * transaction per attendee: a refusal is reported for that attendee only,
	 * and running it again creates nothing new.
	 */
	async issue(
		input: SeminarIssueInput,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE,
		now: Date = new Date()
	): Promise<SeminarIssueResult> {
		const staffId = requireActor(actorId)
		const session = await this.requireSession(
			input.scheduleSlotId,
			staffId,
			"seminar_session.issue",
			scope
		)
		const roster = await this.attendeesOf([session.scheduleSlotId])
		const byId = new Map(roster.map(row => [row.bookingItemId, row]))

		const ids = [
			...new Set(
				input.bookingItemIds ??
					roster
						.filter(row => row.status === "cleared" || row.status === "issued")
						.map(row => row.bookingItemId)
			),
		]

		const results: SeminarIssueResult["results"] = []
		for (const id of ids) {
			const attendee = byId.get(id)
			if (!attendee) {
				results.push({
					bookingItemId: id,
					outcome: "not_found",
					message: "This attendee is not in this session",
					documentNumber: null,
				})
				continue
			}
			if (attendee.status !== "cleared" && attendee.status !== "issued") {
				results.push({
					bookingItemId: id,
					outcome: "refused",
					message: "Mark this attendee present before issuing a certificate",
					documentNumber: null,
				})
				continue
			}
			try {
				const issued = await db.transaction(tx =>
					this.documentService.issue(tx, { bookingItemId: id, actorId: staffId, now })
				)
				results.push({
					bookingItemId: id,
					outcome: issued.created ? "issued" : "already_issued",
					message: issued.created
						? `Certificate ${issued.document.documentNumber} issued`
						: `Already holds certificate ${issued.document.documentNumber}`,
					documentNumber: issued.document.documentNumber,
				})
			} catch (error) {
				const reason = reasonOf(error)
				if (reason === null) throw error
				results.push({
					bookingItemId: id,
					outcome: "refused",
					message: reason,
					documentNumber: null,
				})
			}
		}
		return { results }
	}

	/** One attendee, in the caller's transaction. Lock order: Booking, then item. */
	private async markOne(
		tx: Transaction,
		attendee: AttendeeRow,
		want: "present" | "absent",
		actorId: string,
		now: Date
	): Promise<{ outcome: "present" | "absent" | "unchanged"; message: string }> {
		const [booking] = await tx
			.select({ id: bookings.id, status: bookings.status })
			.from(bookings)
			.where(eq(bookings.id, attendee.bookingId))
			.for("update")
		const [item] = await tx
			.select({ id: bookingItems.id, status: bookingItems.status })
			.from(bookingItems)
			.where(eq(bookingItems.id, attendee.bookingItemId))
			.for("update")
		if (!booking || !item) {
			throw new ORPCError("NOT_FOUND", { message: "This attendee is no longer in this session" })
		}

		const requirePaid = () => {
			if (booking.status !== "paid") {
				throw new ORPCError("CONFLICT", {
					message: "Payment required: the booking is not paid yet, so attendance cannot be marked.",
				})
			}
		}
		const transition = (to: BookingItemStatus, allowedFrom: readonly BookingItemStatus[]) =>
			this.bookingService.transitionItem(tx, item.id, to, { actorId, allowedFrom, now })

		if (want === "absent") {
			if (item.status === "no_show") {
				return { outcome: "unchanged", message: "Already marked absent" }
			}
			if (item.status !== "booked") {
				throw new ORPCError("CONFLICT", {
					message: "Already checked in, so this attendee cannot be marked absent.",
				})
			}
			requirePaid()
			await transition("no_show", ["booked"])
			// An absentee can be the last open item of a Booking.
			await this.bookingService.completeIfAllItemsFinal(tx, attendee.bookingId, actorId, now)
			return { outcome: "absent", message: "Marked absent" }
		}

		if (item.status === "cleared" || item.status === "issued") {
			return { outcome: "unchanged", message: "Already marked present" }
		}
		if (item.status === "pending_head_approval") {
			return { outcome: "unchanged", message: "Already marked present; waiting for head approval" }
		}
		if (!["booked", "checked_in", "in_assessment"].includes(item.status)) {
			throw new ORPCError("CONFLICT", {
				message: `This attendee is ${item.status.replaceAll("_", " ")} and cannot be marked present.`,
			})
		}

		if (item.status === "booked") {
			requirePaid()
			await transition("checked_in", ["booked"])
		}
		if (item.status === "booked" || item.status === "checked_in") {
			await transition("in_assessment", ["checked_in", "returned"])
		}

		// PRC-4: a Service that configures required steps still needs their results.
		const missing = await missingRequiredSteps(tx, item.id)
		if (missing.length > 0) {
			throw new ORPCError("BAD_REQUEST", {
				message: `Record the result of every required step before clearing: ${missing.join(", ")}.`,
			})
		}
		const moved = await transition("cleared", ["in_assessment"])
		return {
			outcome: "present",
			message:
				moved.to === "pending_head_approval"
					? "Marked present; the head must approve before a certificate can be issued"
					: "Marked present",
		}
	}

	private sessionColumns() {
		return {
			scheduleSlotId: scheduleSlots.id,
			serviceId: services.id,
			serviceName: services.name,
			serviceCategoryId: services.serviceCategoryId,
			documentType: services.documentType,
			locationId: locations.id,
			locationName: locations.name,
			startsAt: scheduleSlots.startsAt,
			endsAt: scheduleSlots.endsAt,
			capacity: scheduleSlots.capacity,
			bookedCount: scheduleSlots.bookedCount,
		}
	}

	/**
	 * 404 unless the slot exists, belongs to a seminar Service and is inside
	 * the caller's Scope. A refused attempt on a session that does exist is
	 * audited as denied.
	 */
	private async requireSession(
		scheduleSlotId: number,
		staffId: string,
		action: string,
		scope: ResolvedScope
	): Promise<SessionRow> {
		const [row] = await db
			.select(this.sessionColumns())
			.from(scheduleSlots)
			.innerJoin(services, eq(services.id, scheduleSlots.serviceId))
			.innerJoin(locations, eq(locations.id, scheduleSlots.locationId))
			.where(eq(scheduleSlots.id, scheduleSlotId))
			.limit(1)
		if (!row || row.documentType !== SEMINAR_DOCUMENT_TYPE) throw sessionNotFound()

		if (!inScope(scope, { serviceCategoryId: row.serviceCategoryId, locationId: row.locationId })) {
			// Recorded outside any transaction, so the denial is kept when the request fails.
			await this.auditService.record({
				domain: AUDIT_DOMAIN_CERTIFICATES,
				action,
				outcome: "denied",
				actorId: staffId,
				targetType: "schedule_slot",
				targetId: String(scheduleSlotId),
				reason: "outside_scope",
			})
			throw sessionNotFound()
		}
		return row
	}

	/** The clients booked into the given slots, by Reference Number. */
	private async attendeesOf(scheduleSlotIds: number[]): Promise<AttendeeRow[]> {
		return db
			.select({
				scheduleSlotId: bookingItems.scheduleSlotId,
				bookingItemId: bookingItems.id,
				bookingId: bookingItems.bookingId,
				referenceNumber: bookings.referenceNumber,
				clientName: users.name,
				status: bookingItems.status,
				bookingStatus: bookings.status,
				documentNumber: documents.documentNumber,
			})
			.from(bookingItems)
			.innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
			.innerJoin(users, eq(users.id, bookings.clientId))
			.leftJoin(
				documents,
				and(
					eq(documents.bookingItemId, bookingItems.id),
					eq(documents.documentType, SEMINAR_DOCUMENT_TYPE)
				)
			)
			.where(
				and(
					inArray(bookingItems.scheduleSlotId, scheduleSlotIds),
					inArray(bookings.status, LISTED_BOOKING_STATUSES)
				)
			)
			.orderBy(asc(bookings.referenceNumber), asc(bookingItems.id))
	}
}
