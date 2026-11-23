import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm"

import type {
	ApprovalQueue,
	ApprovalQueueRequest,
	BookingItemIdParam,
	BookingStatus,
	CheckInInput,
	CheckInResponse,
	DecideApprovalInput,
	OverrideItemInput,
	ProcessingItem,
	ProcessingQueue,
	ProcessingQueueRequest,
	QueuePaymentStatus,
	RecordAssessmentInput,
} from "@repo/contracts"
import {
	assessments,
	bookingItems,
	bookings,
	documents,
	locations,
	scheduleSlots,
	services,
	users,
	userScopes,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import {
	inScope,
	NATIONWIDE_SCOPE,
	scopeCondition,
	type ResolvedScope,
} from "@/common/scope/scope-match"

import { BookingService, type Transaction } from "../bookings/bookings.service"
import { DocumentService } from "../certificates/documents.service"
import { manilaDateOf, manilaDateTimeToUtc } from "../schedules/manila-time"

const AUDIT_DOMAIN_PROCESSING = "processing"

const MS_PER_DAY = 86_400_000

/** Most items the approval queue lists at once (PRC-3). */
const MAX_PENDING_APPROVALS = 200
/** Most recently rejected items listed for override (PRC-3). */
const MAX_REJECTED_FOR_OVERRIDE = 100

/**
 * Bookings staff work on. A cancelled, rejected or refunded Booking has
 * nothing left to assess, so it stays out of the queue.
 */
const QUEUE_BOOKING_STATUSES: BookingStatus[] = ["pending_payment", "paid", "completed"]

/** Annex B: Paid is `paid` or `completed`. */
function paymentStatusOf(status: BookingStatus): QueuePaymentStatus {
	return status === "paid" || status === "completed" ? "paid" : "unpaid"
}

/** The same answer for "not there" and "not yours", so other Locations cannot be probed. */
function itemNotFound() {
	return new ORPCError("NOT_FOUND", { message: "Booking item not found at your location" })
}

interface StaffLocation {
	id: number
	name: string
}

/**
 * BOQ staff assessment (PRC-1, TOR §VIII.3).
 *
 * Every read and write is limited to the staff user's Location, read from
 * `user_scopes` (DOMAIN-MODEL.md section 4). ADM-2 adds the Service Category:
 * the controller passes the caller's Scope, and items outside it are left out
 * of the queue and answer 404.
 * Item status changes go through `BookingService`; this service writes only
 * `assessments`.
 */
@Injectable()
export class ProcessingService {
	constructor(
		private readonly bookingService: BookingService,
		private readonly auditService: AuditService,
		private readonly documentService: DocumentService
	) {}

	/** Booking Items at the caller's Location for one Manila date, earliest first. */
	async queue(
		input: ProcessingQueueRequest,
		actorId: string | null,
		now: Date = new Date(),
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<ProcessingQueue> {
		const staffId = requireActor(actorId)
		const date = input.date ?? manilaDateOf(now)
		const location = await this.staffLocation(staffId)
		if (!location) {
			return { location: null, date, items: [] }
		}

		const dayStart = manilaDateTimeToUtc(date, "00:00")
		const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY)

		const rows = await db
			.select({
				bookingItemId: bookingItems.id,
				status: bookingItems.status,
				referenceNumber: bookings.referenceNumber,
				bookingStatus: bookings.status,
				clientName: users.name,
				serviceName: services.name,
				startsAt: scheduleSlots.startsAt,
				endsAt: scheduleSlots.endsAt,
			})
			.from(bookingItems)
			.innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
			.innerJoin(users, eq(users.id, bookings.clientId))
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.innerJoin(scheduleSlots, eq(scheduleSlots.id, bookingItems.scheduleSlotId))
			.where(
				and(
					eq(bookingItems.locationId, location.id),
					gte(scheduleSlots.startsAt, dayStart),
					lt(scheduleSlots.startsAt, dayEnd),
					inArray(bookings.status, QUEUE_BOOKING_STATUSES),
					scopeCondition(scope, {
						serviceCategoryId: services.serviceCategoryId,
						locationId: bookingItems.locationId,
					})
				)
			)
			.orderBy(asc(scheduleSlots.startsAt), asc(bookings.referenceNumber))

		return {
			location,
			date,
			items: rows.map(row => ({
				...row,
				paymentStatus: paymentStatusOf(row.bookingStatus),
			})),
		}
	}

	/** One Booking Item with the client's profile and assessment history. */
	async item(
		input: BookingItemIdParam,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<ProcessingItem> {
		const staffId = requireActor(actorId)
		// PRC-3: reading needs only Scope, not a station, so a head whose Scope
		// covers several Locations can open an item to approve it.
		await this.requireItemInScope(input.bookingItemId, staffId, "booking_item.read", scope, {
			requireStation: false,
		})
		return this.loadItem(input.bookingItemId)
	}

	/**
	 * Check a client in by Reference Number (from the QR code or typed).
	 * Refused with "Payment required" unless the Booking is paid (Annex B).
	 */
	async checkIn(input: CheckInInput, actorId: string | null): Promise<CheckInResponse> {
		const staffId = requireActor(actorId)
		const location = await this.staffLocation(staffId)

		const [booking] = await db
			.select({ id: bookings.id })
			.from(bookings)
			.where(eq(bookings.referenceNumber, input.referenceNumber))
			.limit(1)
		if (!booking) {
			throw new ORPCError("NOT_FOUND", {
				message: `No booking has the reference number ${input.referenceNumber}`,
			})
		}
		if (!location) {
			await this.recordDenial(
				staffId,
				"booking_item.check_in",
				"booking",
				booking.id,
				"no_location"
			)
			throw new ORPCError("NOT_FOUND", {
				message: `No booking ${input.referenceNumber} at your location`,
			})
		}

		const result = await db.transaction(tx =>
			this.bookingService.checkInItems(tx, booking.id, location.id, staffId)
		)

		if (!result.ok && result.reason === "no_items_here") {
			await this.recordDenial(
				staffId,
				"booking_item.check_in",
				"booking",
				booking.id,
				"outside_scope"
			)
			throw new ORPCError("NOT_FOUND", {
				message: `No booking ${input.referenceNumber} at your location`,
			})
		}
		if (!result.ok) {
			await this.recordDenial(
				staffId,
				"booking_item.check_in",
				"booking",
				booking.id,
				"payment_required"
			)
			throw new ORPCError("CONFLICT", {
				message: `Payment required: booking ${input.referenceNumber} is not paid yet, so the client cannot be checked in.`,
			})
		}

		const items = await Promise.all(result.bookingItemIds.map(id => this.loadItem(id)))
		return { items }
	}

	/** Start assessing: `checked_in` (or `returned`, after the client corrects it) to `in_assessment`. */
	async open(
		input: BookingItemIdParam,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<ProcessingItem> {
		const staffId = requireActor(actorId)
		await this.requireItemInScope(input.bookingItemId, staffId, "booking_item.open", scope)

		await db.transaction(tx =>
			this.bookingService.transitionItem(tx, input.bookingItemId, "in_assessment", {
				actorId: staffId,
				allowedFrom: ["checked_in", "returned"],
			})
		)
		return this.loadItem(input.bookingItemId)
	}

	/**
	 * Record an Assessment and move the item: cleared (or pending head
	 * approval), returned for correction, or rejected. The Assessment row, the
	 * item's new status and both Audit Entries commit together.
	 *
	 * CRT-1: when the item is cleared and its Service issues a document
	 * automatically, the document is issued in this same transaction, recorded
	 * against this officer. If the certificate details are missing, nothing is
	 * saved.
	 */
	async assess(
		input: RecordAssessmentInput,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<ProcessingItem> {
		const staffId = requireActor(actorId)
		await this.requireItemInScope(input.bookingItemId, staffId, "assessment.create", scope)

		await db.transaction(async tx => {
			const moved = await this.bookingService.transitionItem(
				tx,
				input.bookingItemId,
				input.outcome,
				{ actorId: staffId, allowedFrom: ["in_assessment"] }
			)

			if (moved.to === "cleared") {
				await this.documentService.issueOnClearance(tx, {
					bookingItemId: input.bookingItemId,
					actorId: staffId,
					details: input.document ?? null,
					exemption: input.exemption ?? null,
				})
			} else if (input.exemption) {
				// CRT-3: never drop an exemption silently. An item waiting for head
				// approval gets its certificate issued once it is cleared.
				throw new ORPCError("BAD_REQUEST", {
					message:
						moved.to === "pending_head_approval"
							? "This item needs head approval first. Issue the Medical Exemption Certificate once it is cleared."
							: "A medical exemption is recorded only when the item is cleared.",
				})
			}

			const notes = input.notes.length > 0 ? input.notes : null
			const [saved] = await tx
				.insert(assessments)
				.values({
					bookingItemId: input.bookingItemId,
					staffId,
					outcome: input.outcome,
					notes,
					corrections: input.corrections,
					// Set here, in UTC, rather than by the database clock (DOMAIN-MODEL.md: timestamps are UTC).
					createdAt: new Date(),
				})
				.returning({ id: assessments.id })
			if (!saved) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "The assessment could not be saved",
				})
			}

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_PROCESSING,
					action: "assessment.create",
					actorId: staffId,
					targetType: "booking_item",
					targetId: String(input.bookingItemId),
					oldValue: { status: moved.from },
					newValue: {
						assessmentId: saved.id,
						outcome: input.outcome,
						status: moved.to,
						notes,
						corrections: input.corrections,
					},
				},
				tx
			)
		})

		return this.loadItem(input.bookingItemId)
	}

	/**
	 * The head's approval queue (PRC-3): items waiting in
	 * `pending_head_approval` (oldest appointment first), or recently rejected
	 * items an approver may override. Limited to the caller's Scope.
	 */
	async approvals(
		input: ApprovalQueueRequest,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<ApprovalQueue> {
		requireActor(actorId)
		const status = input.view === "pending" ? "pending_head_approval" : "rejected"

		const rows = await db
			.select({
				bookingItemId: bookingItems.id,
				status: bookingItems.status,
				referenceNumber: bookings.referenceNumber,
				clientName: users.name,
				serviceName: services.name,
				locationId: locations.id,
				locationName: locations.name,
				startsAt: scheduleSlots.startsAt,
			})
			.from(bookingItems)
			.innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
			.innerJoin(users, eq(users.id, bookings.clientId))
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.innerJoin(locations, eq(locations.id, bookingItems.locationId))
			.innerJoin(scheduleSlots, eq(scheduleSlots.id, bookingItems.scheduleSlotId))
			.where(
				and(
					eq(bookingItems.status, status),
					scopeCondition(scope, {
						serviceCategoryId: services.serviceCategoryId,
						locationId: bookingItems.locationId,
					})
				)
			)
			.orderBy(
				input.view === "pending" ? asc(scheduleSlots.startsAt) : desc(bookingItems.updatedAt),
				asc(bookingItems.id)
			)
			.limit(input.view === "pending" ? MAX_PENDING_APPROVALS : MAX_REJECTED_FOR_OVERRIDE)

		const latest = await this.latestAssessments(rows.map(row => row.bookingItemId))

		return {
			view: input.view,
			items: rows.map(row => {
				const assessed = latest.get(row.bookingItemId)
				return {
					bookingItemId: row.bookingItemId,
					referenceNumber: row.referenceNumber,
					status: row.status,
					clientName: row.clientName,
					serviceName: row.serviceName,
					location: { id: row.locationId, name: row.locationName },
					startsAt: row.startsAt,
					assessedBy: assessed?.staffName ?? null,
					assessedAt: assessed?.createdAt ?? null,
					notes: assessed?.notes ?? null,
				}
			}),
		}
	}

	/**
	 * Head approval (PRC-3, Annex A). `approve` moves `pending_head_approval`
	 * to `cleared`; `return` sends it back to `in_assessment` with notes. The
	 * officer who cleared the item may not approve it (403, audited). The
	 * decision row, the item's new status and the Audit Entries commit
	 * together. Documents are issued afterwards through CRT-1, which needs the
	 * item to be `cleared`.
	 */
	async decide(
		input: DecideApprovalInput,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<ProcessingItem> {
		const approverId = requireActor(actorId)
		const action = input.decision === "approve" ? "assessment.approve" : "assessment.send_back"
		await this.requireItemInScope(input.bookingItemId, approverId, action, scope, {
			requireStation: false,
		})

		const [cleared] = await db
			.select({ staffId: assessments.staffId })
			.from(assessments)
			.where(
				and(
					eq(assessments.bookingItemId, input.bookingItemId),
					eq(assessments.kind, "assessment"),
					eq(assessments.outcome, "cleared")
				)
			)
			.orderBy(desc(assessments.createdAt), desc(assessments.id))
			.limit(1)
		if (cleared?.staffId === approverId) {
			await this.recordDenial(
				approverId,
				action,
				"booking_item",
				input.bookingItemId,
				"own_assessment"
			)
			throw new ORPCError("FORBIDDEN", {
				message: "You cleared this item yourself, so another approver must review it",
			})
		}

		const to = input.decision === "approve" ? "cleared" : "in_assessment"
		const outcome = input.decision === "approve" ? "cleared" : "returned"
		const notes = input.notes.length > 0 ? input.notes : null

		await db.transaction(async tx => {
			const moved = await this.bookingService.transitionItem(tx, input.bookingItemId, to, {
				actorId: approverId,
				allowedFrom: ["pending_head_approval"],
			})
			const saved = await this.insertDecision(tx, {
				bookingItemId: input.bookingItemId,
				staffId: approverId,
				outcome,
				kind: "approval",
				notes,
			})
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_PROCESSING,
					action,
					actorId: approverId,
					targetType: "booking_item",
					targetId: String(input.bookingItemId),
					oldValue: { status: moved.from },
					newValue: { assessmentId: saved, decision: input.decision, status: moved.to, notes },
				},
				tx
			)
		})

		return this.loadItem(input.bookingItemId)
	}

	/**
	 * Override a rejected item to `cleared` (PRC-3, Annex A: the Module Admin
	 * may override). The reason is mandatory; the override row, the item's
	 * new status and the Audit Entries with the before and after state commit
	 * together.
	 */
	async override(
		input: OverrideItemInput,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<ProcessingItem> {
		const approverId = requireActor(actorId)
		await this.requireItemInScope(input.bookingItemId, approverId, "assessment.override", scope, {
			requireStation: false,
		})

		await db.transaction(async tx => {
			const moved = await this.bookingService.overrideItem(tx, input.bookingItemId, "cleared", {
				actorId: approverId,
				reason: input.reason,
			})
			const saved = await this.insertDecision(tx, {
				bookingItemId: input.bookingItemId,
				staffId: approverId,
				outcome: "cleared",
				kind: "override",
				notes: input.reason,
			})
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_PROCESSING,
					action: "assessment.override",
					actorId: approverId,
					targetType: "booking_item",
					targetId: String(input.bookingItemId),
					oldValue: { status: moved.from },
					newValue: { assessmentId: saved, status: moved.to },
					reason: input.reason,
				},
				tx
			)
		})

		return this.loadItem(input.bookingItemId)
	}

	/** Insert one decision row (PRC-3) and return its id. */
	private async insertDecision(
		tx: Transaction,
		row: {
			bookingItemId: number
			staffId: string
			outcome: "cleared" | "returned"
			kind: "approval" | "override"
			notes: string | null
		}
	): Promise<number> {
		const [saved] = await tx
			.insert(assessments)
			.values({
				...row,
				corrections: {},
				// Set here, in UTC, rather than by the database clock (DOMAIN-MODEL.md: timestamps are UTC).
				createdAt: new Date(),
			})
			.returning({ id: assessments.id })
		if (!saved) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The decision could not be saved" })
		}
		return saved.id
	}

	/** The newest officer Assessment for each item, for the approval queue. */
	private async latestAssessments(
		bookingItemIds: number[]
	): Promise<Map<number, { staffName: string; createdAt: Date; notes: string | null }>> {
		const latest = new Map<number, { staffName: string; createdAt: Date; notes: string | null }>()
		if (bookingItemIds.length === 0) return latest

		const rows = await db
			.select({
				bookingItemId: assessments.bookingItemId,
				staffName: users.name,
				createdAt: assessments.createdAt,
				notes: assessments.notes,
			})
			.from(assessments)
			.innerJoin(users, eq(users.id, assessments.staffId))
			.where(
				and(inArray(assessments.bookingItemId, bookingItemIds), eq(assessments.kind, "assessment"))
			)
			.orderBy(desc(assessments.createdAt), desc(assessments.id))
		for (const row of rows) {
			if (!latest.has(row.bookingItemId)) {
				latest.set(row.bookingItemId, {
					staffName: row.staffName,
					createdAt: row.createdAt,
					notes: row.notes,
				})
			}
		}
		return latest
	}

	/**
	 * The staff user's Location from `user_scopes`, or null when they have none.
	 *
	 * PRC-1 supports one Location per staff user: the first scope row that names
	 * a Location. A row with a null `location_id` ("all Locations") and several
	 * Locations per user are handled by ADM-2's `ScopeService`.
	 */
	private async staffLocation(staffId: string): Promise<StaffLocation | null> {
		const [row] = await db
			.select({ id: locations.id, name: locations.name })
			.from(userScopes)
			.innerJoin(locations, eq(locations.id, userScopes.locationId))
			.where(eq(userScopes.userId, staffId))
			.orderBy(asc(userScopes.id))
			.limit(1)
		return row ?? null
	}

	/**
	 * 404 unless the item exists, is at the caller's Location, and its Service
	 * Category is in the caller's Scope (ADM-2). A refused attempt on an item
	 * that does exist is audited as denied.
	 */
	private async requireItemInScope(
		bookingItemId: number,
		staffId: string,
		action: string,
		scope: ResolvedScope = NATIONWIDE_SCOPE,
		options: { requireStation: boolean } = { requireStation: true }
	): Promise<void> {
		const [item] = await db
			.select({
				id: bookingItems.id,
				locationId: bookingItems.locationId,
				serviceCategoryId: services.serviceCategoryId,
			})
			.from(bookingItems)
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.where(eq(bookingItems.id, bookingItemId))
			.limit(1)
		if (!item) throw itemNotFound()

		if (
			!inScope(scope, { serviceCategoryId: item.serviceCategoryId, locationId: item.locationId })
		) {
			await this.recordDenial(staffId, action, "booking_item", bookingItemId, "outside_scope")
			throw itemNotFound()
		}
		// Approvers and readers act on any item in Scope; officers' changes also
		// need the item to be at their station (PRC-1).
		if (!options.requireStation) return

		const location = await this.staffLocation(staffId)
		if (!location || location.id !== item.locationId) {
			await this.recordDenial(
				staffId,
				action,
				"booking_item",
				bookingItemId,
				location ? "outside_scope" : "no_location"
			)
			throw itemNotFound()
		}
	}

	/** Everything the assessment screen shows. Call only after the scope check. */
	private async loadItem(bookingItemId: number): Promise<ProcessingItem> {
		const [row] = await db
			.select({
				bookingItemId: bookingItems.id,
				status: bookingItems.status,
				feeCentavos: bookingItems.feeCentavos,
				bookingId: bookings.id,
				referenceNumber: bookings.referenceNumber,
				bookingStatus: bookings.status,
				kind: bookings.kind,
				totalCentavos: bookings.totalCentavos,
				serviceId: services.id,
				serviceName: services.name,
				requiresApproval: services.requiresApproval,
				documentType: services.documentType,
				autoIssue: services.autoIssue,
				documentId: documents.id,
				documentNumber: documents.documentNumber,
				issuedDocumentType: documents.documentType,
				printCount: documents.printCount,
				locationId: locations.id,
				locationName: locations.name,
				startsAt: scheduleSlots.startsAt,
				endsAt: scheduleSlots.endsAt,
				clientId: users.id,
				clientName: users.name,
				clientEmail: users.email,
				clientMobile: users.mobile,
				clientBirthDate: users.birthDate,
				clientGender: users.gender,
				clientNationality: users.nationality,
			})
			.from(bookingItems)
			.innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
			.innerJoin(users, eq(users.id, bookings.clientId))
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.innerJoin(locations, eq(locations.id, bookingItems.locationId))
			.innerJoin(scheduleSlots, eq(scheduleSlots.id, bookingItems.scheduleSlotId))
			.leftJoin(
				documents,
				and(eq(documents.bookingItemId, bookingItems.id), eq(documents.status, "valid"))
			)
			.where(eq(bookingItems.id, bookingItemId))
			.limit(1)
		if (!row) throw itemNotFound()

		const history = await db
			.select({
				id: assessments.id,
				outcome: assessments.outcome,
				kind: assessments.kind,
				notes: assessments.notes,
				corrections: assessments.corrections,
				staffId: assessments.staffId,
				staffName: users.name,
				createdAt: assessments.createdAt,
			})
			.from(assessments)
			.innerJoin(users, eq(users.id, assessments.staffId))
			.where(eq(assessments.bookingItemId, bookingItemId))
			.orderBy(desc(assessments.createdAt), desc(assessments.id))

		return {
			bookingItemId: row.bookingItemId,
			status: row.status,
			booking: {
				id: row.bookingId,
				referenceNumber: row.referenceNumber,
				status: row.bookingStatus,
				kind: row.kind,
				totalCentavos: row.totalCentavos,
			},
			paymentStatus: paymentStatusOf(row.bookingStatus),
			service: {
				id: row.serviceId,
				name: row.serviceName,
				requiresApproval: row.requiresApproval,
				documentType: row.documentType,
				autoIssue: row.autoIssue,
			},
			document:
				row.documentId !== null && row.documentNumber !== null && row.issuedDocumentType !== null
					? {
							id: row.documentId,
							documentNumber: row.documentNumber,
							documentType: row.issuedDocumentType,
							printCount: row.printCount ?? 0,
						}
					: null,
			location: { id: row.locationId, name: row.locationName },
			startsAt: row.startsAt,
			endsAt: row.endsAt,
			feeCentavos: row.feeCentavos,
			client: {
				id: row.clientId,
				name: row.clientName,
				email: row.clientEmail,
				mobile: row.clientMobile,
				birthDate: row.clientBirthDate,
				gender: row.clientGender,
				nationality: row.clientNationality,
			},
			// `form_submissions` arrives with the forms epic; until then there is nothing to show.
			formAnswers: {},
			assessments: history,
		}
	}

	/** Recorded outside any transaction, so the denial is kept when the request fails. */
	private async recordDenial(
		staffId: string,
		action: string,
		targetType: "booking" | "booking_item",
		targetId: number,
		reason: "outside_scope" | "no_location" | "payment_required" | "own_assessment"
	): Promise<void> {
		await this.auditService.record({
			domain: AUDIT_DOMAIN_PROCESSING,
			action,
			outcome: "denied",
			actorId: staffId,
			targetType,
			targetId: String(targetId),
			reason,
		})
	}
}

function requireActor(actorId: string | null): string {
	if (!actorId) {
		throw new ORPCError("UNAUTHORIZED", { message: "Sign in to use processing" })
	}
	return actorId
}
