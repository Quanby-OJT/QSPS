import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { asc, eq } from "drizzle-orm"

import {
	bookingItems,
	bookings,
	locations,
	serviceCategories,
	services,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { PdfService } from "@/common/pdf/pdf.service"
import { inScope, NATIONWIDE_SCOPE, type ResolvedScope } from "@/common/scope/scope-match"
import { displayEmail, NO_EMAIL_LABEL } from "@/common/users/placeholder-email"
import { readableAnswers } from "@/modules/v1/forms/form-answers-display"
import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

import {
	APPLICANT_TYPE_QUESTION,
	applicantTypeOf,
	drawApplicationForm,
	type ApplicantType,
	type ApplicationFormData,
} from "./application-form"
import { drawRequestForPayment, type RequestForPaymentData } from "./request-for-payment"

const AUDIT_DOMAIN_CERTIFICATES = "certificates"

/** The Service Category code for Physical Examination (DOMAIN-MODEL.md glossary). */
export const PHYSICAL_EXAM_CATEGORY_CODE = "physical-exam"

export interface RenderedPrintout {
	fileName: string
	pdf: Buffer
}

/** One Booking Item with everything the application form needs. */
async function loadItem(bookingItemId: number) {
	const [row] = await db
		.select({
			id: bookingItems.id,
			bookingId: bookingItems.bookingId,
			locationId: bookingItems.locationId,
			serviceName: services.name,
			serviceCategoryId: services.serviceCategoryId,
			categoryCode: serviceCategories.code,
			locationName: locations.name,
			referenceNumber: bookings.referenceNumber,
			clientId: bookings.clientId,
			clientName: users.name,
			email: users.email,
			mobile: users.mobile,
			birthDate: users.birthDate,
			gender: users.gender,
			nationality: users.nationality,
		})
		.from(bookingItems)
		.innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
		.innerJoin(services, eq(services.id, bookingItems.serviceId))
		.innerJoin(serviceCategories, eq(serviceCategories.id, services.serviceCategoryId))
		.innerJoin(locations, eq(locations.id, bookingItems.locationId))
		.innerJoin(users, eq(users.id, bookings.clientId))
		.where(eq(bookingItems.id, bookingItemId))
		.limit(1)
	return row ?? null
}

type ItemRow = NonNullable<Awaited<ReturnType<typeof loadItem>>>

/**
 * Printouts that are not issued Documents (CRT-4): the Physical Examination
 * application form and the Request for Payment. No Document Number is used
 * and no `documents` row is created. Rendered on demand from the database,
 * never stored.
 *
 * Called from plain routes, so it throws Nest exceptions, not ORPCError.
 * `certificates.documents:print` and `bookings.own:read` are checked by the
 * routes; the Scope and ownership checks are here.
 */
@Injectable()
export class PrintoutService {
	constructor(
		private readonly auditService: AuditService,
		private readonly pdfService: PdfService
	) {}

	/**
	 * Staff print the application form for a Physical Examination Booking Item.
	 * The item must be in the caller's Scope; anything else gets the same 404 as
	 * a missing item, and an attempt on an item that exists is audited as denied.
	 */
	async applicationFormForStaff(
		bookingItemId: number,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<RenderedPrintout> {
		const row = await loadItem(bookingItemId)
		const allowed =
			!!row &&
			!!actorId &&
			inScope(scope, { serviceCategoryId: row.serviceCategoryId, locationId: row.locationId })
		if (!row || !allowed) {
			if (actorId && row) {
				await this.recordDenied(
					"printout.application",
					"booking_item",
					row.id,
					actorId,
					"outside_scope"
				)
			}
			throw new NotFoundException("Booking item not found")
		}

		const { fileName, pdf, variant } = await this.renderApplication(row)
		await this.auditService.record({
			domain: AUDIT_DOMAIN_CERTIFICATES,
			action: "printout.application",
			actorId,
			targetType: "booking_item",
			targetId: String(row.id),
			oldValue: null,
			// Names the printout, not the client's answers.
			newValue: { bookingId: row.bookingId, referenceNumber: row.referenceNumber, variant },
		})
		return { fileName, pdf }
	}

	/**
	 * The client downloads their own application form. Anyone else, and an
	 * item that does not exist, gets the same 404; the attempt is audited.
	 */
	async applicationFormForOwner(
		bookingItemId: number,
		actorId: string | null
	): Promise<RenderedPrintout> {
		const row = await loadItem(bookingItemId)
		if (!row || !actorId || row.clientId !== actorId) {
			if (actorId) {
				await this.recordDenied(
					"printout.application.read",
					"booking_item",
					bookingItemId,
					actorId,
					row ? "not_owner" : "not_found"
				)
			}
			throw new NotFoundException("Booking item not found")
		}
		const { fileName, pdf } = await this.renderApplication(row)
		return { fileName, pdf }
	}

	/**
	 * Staff print the Request for Payment for an unpaid Physical Examination
	 * Booking, for the cashier. Every item must be in the caller's Scope
	 * (assumption: confirm with the lead). Only a Booking awaiting payment can
	 * have one.
	 */
	async requestForPaymentForStaff(
		bookingId: number,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<RenderedPrintout> {
		const [booking] = await db
			.select({
				id: bookings.id,
				referenceNumber: bookings.referenceNumber,
				status: bookings.status,
				totalCentavos: bookings.totalCentavos,
				clientName: users.name,
			})
			.from(bookings)
			.innerJoin(users, eq(users.id, bookings.clientId))
			.where(eq(bookings.id, bookingId))
			.limit(1)

		const items = booking
			? await db
					.select({
						serviceName: services.name,
						feeCentavos: bookingItems.feeCentavos,
						locationName: locations.name,
						locationId: bookingItems.locationId,
						serviceCategoryId: services.serviceCategoryId,
						categoryCode: serviceCategories.code,
					})
					.from(bookingItems)
					.innerJoin(services, eq(services.id, bookingItems.serviceId))
					.innerJoin(serviceCategories, eq(serviceCategories.id, services.serviceCategoryId))
					.innerJoin(locations, eq(locations.id, bookingItems.locationId))
					.where(eq(bookingItems.bookingId, bookingId))
					.orderBy(asc(bookingItems.id))
			: []

		const allowed =
			!!booking &&
			!!actorId &&
			items.length > 0 &&
			items.every(item =>
				inScope(scope, { serviceCategoryId: item.serviceCategoryId, locationId: item.locationId })
			)
		if (!booking || !allowed) {
			if (actorId && booking) {
				await this.recordDenied(
					"printout.request_for_payment",
					"booking",
					booking.id,
					actorId,
					"outside_scope"
				)
			}
			throw new NotFoundException("Booking not found")
		}

		if (!items.some(item => item.categoryCode === PHYSICAL_EXAM_CATEGORY_CODE)) {
			throw new ConflictException("A Request for Payment is for Physical Examination bookings")
		}
		if (booking.status !== "pending_payment") {
			throw new ConflictException(
				booking.status === "paid" || booking.status === "completed"
					? "This booking is already paid"
					: `Only a booking awaiting payment can have a Request for Payment; this one is ${booking.status.replaceAll("_", " ")}`
			)
		}

		const data: RequestForPaymentData = {
			referenceNumber: booking.referenceNumber,
			clientName: booking.clientName,
			printedOn: manilaDateOf(new Date()),
			items: items.map(item => ({
				serviceName: item.serviceName,
				locationName: item.locationName,
				feeCentavos: item.feeCentavos,
			})),
			totalCentavos: booking.totalCentavos,
		}
		const qrPng = await this.pdfService.qrPng(booking.referenceNumber)
		const pdf = await this.pdfService.render(
			{ title: `Request for Payment ${booking.referenceNumber}` },
			doc => drawRequestForPayment(doc, data, qrPng)
		)

		await this.auditService.record({
			domain: AUDIT_DOMAIN_CERTIFICATES,
			action: "printout.request_for_payment",
			actorId,
			targetType: "booking",
			targetId: String(booking.id),
			oldValue: null,
			newValue: { referenceNumber: booking.referenceNumber, totalCentavos: booking.totalCentavos },
		})
		return { fileName: `request-for-payment-${booking.referenceNumber}.pdf`, pdf }
	}

	/** Choose the Local or Foreign form from the client's own answer, then draw it. */
	private async renderApplication(
		row: ItemRow
	): Promise<RenderedPrintout & { variant: ApplicantType }> {
		if (row.categoryCode !== PHYSICAL_EXAM_CATEGORY_CODE) {
			throw new ConflictException("The application form is only for Physical Examination services")
		}
		const answers = await readableAnswers(db, row.id)
		const variant = applicantTypeOf(answers)
		if (!variant) {
			throw new ConflictException(
				`The client has not said whether they are Local or Foreign. The "${APPLICANT_TYPE_QUESTION}" question needs an answer first.`
			)
		}

		const data: ApplicationFormData = {
			variant,
			referenceNumber: row.referenceNumber,
			serviceName: row.serviceName,
			locationName: row.locationName,
			profile: {
				name: row.clientName,
				// A mobile-only walk-in client has no email to print (PRC-2b).
				email: displayEmail(row.email) ?? NO_EMAIL_LABEL,
				mobile: row.mobile,
				birthDate: row.birthDate,
				gender: row.gender,
				nationality: row.nationality,
			},
			answers,
		}
		const qrPng = await this.pdfService.qrPng(row.referenceNumber)
		const pdf = await this.pdfService.render(
			{ title: `Application form ${row.referenceNumber}` },
			doc => drawApplicationForm(doc, data, qrPng)
		)
		return { fileName: `application-form-${row.referenceNumber}.pdf`, pdf, variant }
	}

	private async recordDenied(
		action: string,
		targetType: string,
		targetId: number,
		actorId: string,
		reason: string
	): Promise<void> {
		await this.auditService.record({
			domain: AUDIT_DOMAIN_CERTIFICATES,
			action,
			outcome: "denied",
			actorId,
			targetType,
			targetId: String(targetId),
			reason,
		})
	}
}
