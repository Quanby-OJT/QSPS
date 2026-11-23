import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { timingSafeEqual } from "node:crypto"
import { ORPCError } from "@orpc/server"
import { and, desc, eq, sql, type SQL } from "drizzle-orm"

import type {
	DocumentSummary,
	DocumentVerification,
	IcvIssueDetails,
	IssueDocumentInput,
	ManualVerificationInput,
	MedicalExemptionDetails,
	MyDocuments,
} from "@repo/contracts"
import {
	bookingItems,
	bookings,
	documents,
	documentSequences,
	locations,
	services,
	users,
	userScopes,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { NotificationService } from "@/common/notifications/notification.service"
import { PdfService } from "@/common/pdf/pdf.service"
import { inScope, NATIONWIDE_SCOPE, type ResolvedScope } from "@/common/scope/scope-match"
import { env } from "@/config/env.config"

import { BookingService, type Transaction } from "../bookings/bookings.service"
import { newVerificationToken } from "../payments/receipt-number"
import { formatDocumentNumber } from "./document-number"
import type { PdfExtras, RenderableDocumentType } from "./document-types/document-type"
import {
	documentTypeFor,
	isVaccinationType,
	medicalExemption,
	serviceDocumentTypeFor,
} from "./document-types/registry"
import { holderNameOf, maskName } from "./mask-name"

const AUDIT_DOMAIN_CERTIFICATES = "certificates"

/**
 * Same rules as `DocumentTokenSchema` and `ManualVerificationSchema` in
 * @repo/contracts. Kept here because backend Jest cannot load that package's
 * runtime exports (see manila-time.ts).
 */
const DOCUMENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/
const VERIFICATION_CODE_LENGTH = 8
const VERIFICATION_CODE_PATTERN = /^[A-Za-z0-9_-]{8}$/

/** One answer for every miss, so a lookup reveals nothing about why it failed. */
function noRecord(): ORPCError<"NOT_FOUND", unknown> {
	return new ORPCError("NOT_FOUND", { message: "No record found" })
}

/** Constant-time comparison of the code under the QR code with the token's tail. */
function codeMatches(token: string, code: string): boolean {
	const tail = Buffer.from(token.slice(-VERIFICATION_CODE_LENGTH))
	const given = Buffer.from(code)
	return tail.length === given.length && timingSafeEqual(tail, given)
}

/** The public page a document's QR code points to (built in CRT-2, Flow D step 5). */
export function documentVerifyUrl(token: string): string {
	return `${env.APP_WEB_URL}/verify/${token}`
}

export interface IssueRequest {
	bookingItemId: number
	/** The officer issuing; for auto-issue, whoever made the item cleared (officer, approver or override). */
	actorId: string
	/** What staff typed for the Service's own document (the vaccination record). */
	details?: IcvIssueDetails | null
	/**
	 * CRT-3: the client is medically exempt, so a Medical Exemption Certificate
	 * is issued instead of the vaccination record. Give this or `details`.
	 */
	exemption?: MedicalExemptionDetails | null
	now?: Date
}

/** A print of an existing document (CRT-3). */
export interface PrintResult {
	fileName: string
	pdf: Buffer
	/** How many times the document has been printed, this print included. */
	printCount: number
}

export interface IssueResult {
	document: DocumentSummary
	/** False when the item already had a valid document, which is returned instead. */
	created: boolean
}

/**
 * Documents (CRT-1, Flow D steps 1 to 4). The only code that writes
 * `documents` and `document_sequences`. Item and Booking status changes go
 * through `BookingService` (DOMAIN-MODEL.md section 6).
 */
@Injectable()
export class DocumentService {
	constructor(
		private readonly auditService: AuditService,
		private readonly bookingService: BookingService,
		private readonly pdfService: PdfService
	) {}

	/**
	 * Issue the document for one cleared Booking Item, in the caller's
	 * transaction (Flow D steps 2 to 4).
	 *
	 * Locks the item, returns its existing valid document if there is one (so
	 * issuing twice is harmless; a partial unique index backs this up), refuses
	 * an item that is not `cleared`, then takes the next number for the type and
	 * Location under a row lock. The document, the item's move to `issued`, the
	 * Booking's move to `completed` when every item is final, and the audit
	 * entries commit together or not at all.
	 */
	async issue(tx: Transaction, request: IssueRequest): Promise<IssueResult> {
		const now = request.now ?? new Date()

		const [item] = await tx
			.select({
				id: bookingItems.id,
				status: bookingItems.status,
				bookingId: bookingItems.bookingId,
				serviceId: bookingItems.serviceId,
				locationId: bookingItems.locationId,
			})
			.from(bookingItems)
			.where(eq(bookingItems.id, request.bookingItemId))
			.for("update")
		if (!item) {
			throw new ORPCError("NOT_FOUND", { message: "Booking item not found" })
		}

		const existing = await this.validDocumentFor(tx, item.id)
		if (existing) return { document: existing, created: false }

		if (item.status !== "cleared") {
			throw new ORPCError("CONFLICT", {
				message: `Only a cleared item can get a document; this item is ${item.status.replaceAll("_", " ")}`,
			})
		}

		const [context] = await tx
			.select({
				documentType: services.documentType,
				serviceName: services.name,
				locationCode: locations.code,
				locationName: locations.name,
				referenceNumber: bookings.referenceNumber,
				holderName: users.name,
				holderBirthDate: users.birthDate,
				holderGender: users.gender,
				holderNationality: users.nationality,
			})
			.from(bookingItems)
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.innerJoin(locations, eq(locations.id, bookingItems.locationId))
			.innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
			.innerJoin(users, eq(users.id, bookings.clientId))
			.where(eq(bookingItems.id, item.id))
			.limit(1)
		if (!context) {
			throw new ORPCError("NOT_FOUND", { message: "Booking item not found" })
		}

		const serviceType = serviceDocumentTypeFor(context.documentType)
		if (!serviceType) {
			throw new ORPCError("CONFLICT", {
				message: `${context.serviceName} does not issue a document QSPS can generate yet`,
			})
		}
		const issueContext = {
			holder: {
				name: context.holderName,
				birthDate: context.holderBirthDate,
				gender: context.holderGender,
				nationality: context.holderNationality,
			},
			serviceName: context.serviceName,
			locationName: context.locationName,
			issuedAt: now,
		}

		// CRT-3: an exempt client gets a Medical Exemption Certificate, with its
		// own number series and QR code, instead of the vaccination record.
		let type: RenderableDocumentType
		let payload: Record<string, unknown>
		let validUntil: string | null
		if (request.exemption) {
			if (!isVaccinationType(serviceType.type)) {
				throw new ORPCError("CONFLICT", {
					message: `A medical exemption applies only to a vaccination; ${context.serviceName} is not one`,
				})
			}
			type = medicalExemption
			payload = medicalExemption.buildPayload(issueContext, request.exemption)
			validUntil = medicalExemption.validUntil(request.exemption)
		} else if (request.details) {
			type = serviceType
			payload = serviceType.buildPayload(issueContext, request.details)
			validUntil = serviceType.validUntil(request.details)
		} else {
			throw new ORPCError("BAD_REQUEST", {
				message:
					"Enter the vaccine batch number and the vaccinator, or record the medical exemption.",
			})
		}

		const sequence = await this.nextNumber(tx, type.type, item.locationId, now)
		const documentNumber = formatDocumentNumber(
			type.numberPrefix,
			context.locationCode,
			now,
			sequence
		)
		const [created] = await tx
			.insert(documents)
			.values({
				bookingItemId: item.id,
				documentType: type.type,
				documentNumber,
				verificationToken: newVerificationToken(),
				issuingLocationId: item.locationId,
				issuedBy: request.actorId,
				issuedAt: now,
				validUntil,
				status: "valid",
				source: "qsps",
				payload,
				createdAt: now,
				updatedAt: now,
			})
			.returning({ id: documents.id })
		if (!created) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The document could not be saved" })
		}

		await this.bookingService.transitionItem(tx, item.id, "issued", {
			actorId: request.actorId,
			allowedFrom: ["cleared"],
			now,
		})
		await this.bookingService.completeIfAllItemsFinal(tx, item.bookingId, request.actorId, now)

		await this.auditService.record(
			{
				domain: AUDIT_DOMAIN_CERTIFICATES,
				action: "document.issue",
				actorId: request.actorId,
				targetType: "document",
				targetId: String(created.id),
				oldValue: null,
				// The payload holds personal data; the audit keeps only what identifies the document.
				newValue: {
					bookingItemId: item.id,
					documentType: type.type,
					documentNumber,
					issuingLocationId: item.locationId,
				},
			},
			tx
		)

		await NotificationService.enqueue(
			tx,
			item.bookingId,
			"document_ready",
			`document:${created.id}:issued`
		)
		return {
			document: {
				id: created.id,
				documentType: type.type as DocumentSummary["documentType"],
				documentNumber,
				status: "valid",
				issuedAt: now,
				validUntil,
				serviceName: context.serviceName,
				locationName: context.locationName,
				referenceNumber: context.referenceNumber,
			},
			created: true,
		}
	}

	/**
	 * Auto-issue on clearance (CRT-1). Called by the processing module inside
	 * the transaction that clears the item. Returns null when the Service has
	 * auto-issue off or issues no document. When it does auto-issue, the staff
	 * details are required, so a missing batch number rolls the clearance back.
	 *
	 * CRT-3: with `exemption`, the Medical Exemption Certificate is issued
	 * instead. An exemption on a Service that does not auto-issue is refused, so
	 * it is never silently dropped; staff issue it from the item afterwards.
	 */
	async issueOnClearance(tx: Transaction, request: IssueRequest): Promise<IssueResult | null> {
		const [service] = await tx
			.select({ autoIssue: services.autoIssue, documentType: services.documentType })
			.from(bookingItems)
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.where(eq(bookingItems.id, request.bookingItemId))
			.limit(1)
		if (!service?.autoIssue || !serviceDocumentTypeFor(service.documentType)) {
			if (request.exemption) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"This service does not issue its certificate on clearance. Clear the item first, then issue the Medical Exemption Certificate from the item.",
				})
			}
			return null
		}

		if (!request.details && !request.exemption) {
			throw new ORPCError("BAD_REQUEST", {
				message:
					"This service issues its certificate on clearance. Enter the vaccine batch number and the vaccinator, or record the medical exemption.",
			})
		}
		return this.issue(tx, request)
	}

	/**
	 * Staff issue a document as a separate step (Services with auto-issue off).
	 * The item must be at the caller's Location; anything else answers 404 and
	 * an attempt on an item that exists is audited as denied.
	 */
	async issueAsStaff(input: IssueDocumentInput, actorId: string | null): Promise<DocumentSummary> {
		if (!actorId) {
			throw new ORPCError("UNAUTHORIZED", { message: "Sign in to issue documents" })
		}

		const [item] = await db
			.select({ id: bookingItems.id, locationId: bookingItems.locationId })
			.from(bookingItems)
			.where(eq(bookingItems.id, input.bookingItemId))
			.limit(1)
		if (!item) {
			throw new ORPCError("NOT_FOUND", { message: "Booking item not found at your location" })
		}

		const locationId = await this.staffLocationId(actorId)
		if (locationId !== item.locationId) {
			await this.auditService.record({
				domain: AUDIT_DOMAIN_CERTIFICATES,
				action: "document.issue",
				outcome: "denied",
				actorId,
				targetType: "booking_item",
				targetId: String(item.id),
				reason: locationId === null ? "no_location" : "outside_scope",
			})
			throw new ORPCError("NOT_FOUND", { message: "Booking item not found at your location" })
		}

		const result = await db.transaction(tx =>
			this.issue(tx, {
				bookingItemId: item.id,
				actorId,
				details: input.details,
				exemption: input.exemption,
			})
		)
		return result.document
	}

	/** The signed-in client's documents, newest first (My Documents). */
	async listMine(actorId: string | null): Promise<MyDocuments> {
		if (!actorId) {
			throw new ORPCError("UNAUTHORIZED", { message: "Sign in to see your documents" })
		}
		const rows = await db
			.select({
				id: documents.id,
				documentType: documents.documentType,
				documentNumber: documents.documentNumber,
				status: documents.status,
				issuedAt: documents.issuedAt,
				validUntil: documents.validUntil,
				serviceName: services.name,
				locationName: locations.name,
				referenceNumber: bookings.referenceNumber,
			})
			.from(documents)
			.innerJoin(bookingItems, eq(bookingItems.id, documents.bookingItemId))
			.innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.innerJoin(locations, eq(locations.id, documents.issuingLocationId))
			.where(eq(bookings.clientId, actorId))
			.orderBy(desc(documents.issuedAt), desc(documents.id))

		return {
			documents: rows.map(row => ({
				...row,
				documentType: row.documentType as DocumentSummary["documentType"],
			})),
		}
	}

	/**
	 * The PDF for one document, for the client who owns it. Rendered on demand
	 * from `documents.payload`; never stored. Anyone else gets the same 404,
	 * and the attempt is audited.
	 */
	async renderForOwner(
		documentId: number,
		actorId: string | null
	): Promise<{ fileName: string; pdf: Buffer }> {
		const [row] = await db
			.select({
				documentNumber: documents.documentNumber,
				documentType: documents.documentType,
				status: documents.status,
				verificationToken: documents.verificationToken,
				payload: documents.payload,
				clientId: bookings.clientId,
			})
			.from(documents)
			.innerJoin(bookingItems, eq(bookingItems.id, documents.bookingItemId))
			.innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
			.where(eq(documents.id, documentId))
			.limit(1)

		const type = documentTypeFor(row?.documentType)
		if (!row || !actorId || row.clientId !== actorId || !type) {
			if (actorId) {
				await this.auditService.record({
					domain: AUDIT_DOMAIN_CERTIFICATES,
					action: "document.read",
					outcome: "denied",
					actorId,
					targetType: "document",
					targetId: String(documentId),
					reason: row ? "not_owner" : "not_found",
				})
			}
			throw new NotFoundException("Document not found")
		}

		const verifyUrl = documentVerifyUrl(row.verificationToken)
		const qrPng = await this.pdfService.qrPng(verifyUrl)
		const pdf = await this.pdfService.render(
			{ title: `${type.title} ${row.documentNumber}` },
			doc =>
				type.draw(doc, row.payload, {
					documentNumber: row.documentNumber,
					status: row.status,
					verifyUrl,
					qrPng,
				})
		)
		return { fileName: `${row.documentNumber}.pdf`, pdf }
	}

	/**
	 * Staff print a document (CRT-3): the vaccination record onto the
	 * pre-printed yellow card, shifted by the issuing Location's card offsets,
	 * or any other type on plain A4. Every print adds one to
	 * `documents.print_count` and is audited as `document.print`, with
	 * `reprint` true from the second print on.
	 *
	 * The permission (`certificates.documents:print`) is checked by the route;
	 * here the document must be in the caller's Scope (its Service Category and
	 * issuing Location), or the caller gets the same 404 as a missing document
	 * and the attempt is audited as denied. Only a valid document prints.
	 *
	 * Called from a plain route, so it throws Nest exceptions, not ORPCError.
	 */
	async printForStaff(
		documentId: number,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<PrintResult> {
		const [row] = await db
			.select({
				id: documents.id,
				documentNumber: documents.documentNumber,
				documentType: documents.documentType,
				status: documents.status,
				verificationToken: documents.verificationToken,
				payload: documents.payload,
				printCount: documents.printCount,
				locationId: documents.issuingLocationId,
				cardOffsetXMm: locations.cardOffsetXMm,
				cardOffsetYMm: locations.cardOffsetYMm,
				serviceCategoryId: services.serviceCategoryId,
			})
			.from(documents)
			.innerJoin(locations, eq(locations.id, documents.issuingLocationId))
			.innerJoin(bookingItems, eq(bookingItems.id, documents.bookingItemId))
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.where(eq(documents.id, documentId))
			.limit(1)

		const type = documentTypeFor(row?.documentType)
		const allowed =
			!!row &&
			!!actorId &&
			inScope(scope, { serviceCategoryId: row.serviceCategoryId, locationId: row.locationId })
		if (!row || !type || !allowed) {
			if (actorId && row) {
				await this.auditService.record({
					domain: AUDIT_DOMAIN_CERTIFICATES,
					action: "document.print",
					outcome: "denied",
					actorId,
					targetType: "document",
					targetId: String(documentId),
					reason: "outside_scope",
				})
			}
			throw new NotFoundException("Document not found")
		}
		if (row.status !== "valid") {
			throw new ConflictException(`Only a valid document can be printed; this one is ${row.status}`)
		}

		const verifyUrl = documentVerifyUrl(row.verificationToken)
		const extras: PdfExtras = {
			documentNumber: row.documentNumber,
			status: row.status,
			verifyUrl,
			qrPng: await this.pdfService.qrPng(verifyUrl),
		}
		const card = type.card
		const title = `${type.title} ${row.documentNumber}`
		// Rendered before counting, so a failed render is never counted as a print.
		const pdf = card
			? await this.pdfService.render({ title, size: card.size, margin: 0 }, doc =>
					card.draw(doc, row.payload, extras, {
						xMm: row.cardOffsetXMm,
						yMm: row.cardOffsetYMm,
					})
				)
			: await this.pdfService.render({ title }, doc => type.draw(doc, row.payload, extras))

		const printCount = await db.transaction(async tx => {
			// One atomic increment, so two prints at once both count. The status
			// condition refuses a document revoked since it was read.
			const [counted] = await tx
				.update(documents)
				.set({ printCount: sql`${documents.printCount} + 1` })
				.where(and(eq(documents.id, row.id), eq(documents.status, "valid")))
				.returning({ printCount: documents.printCount })
			if (!counted) {
				throw new ConflictException("Only a valid document can be printed")
			}

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_CERTIFICATES,
					action: "document.print",
					actorId,
					targetType: "document",
					targetId: String(row.id),
					oldValue: { printCount: counted.printCount - 1 },
					newValue: {
						documentNumber: row.documentNumber,
						documentType: type.type,
						layout: card ? "card" : "a4",
						printCount: counted.printCount,
						reprint: counted.printCount > 1,
						...(card ? { offsetsMm: { x: row.cardOffsetXMm, y: row.cardOffsetYMm } } : {}),
					},
				},
				tx
			)
			return counted.printCount
		})

		return { fileName: `${row.documentNumber}.pdf`, pdf, printCount }
	}

	/**
	 * Public lookup behind a document's QR code (CRT-2, Flow D step 5). No
	 * session and no permission: the 128-bit token is the only key. Returns only
	 * what is needed to recognise the document, with the holder's name masked;
	 * never the payload. An unknown or malformed token gets the same 404.
	 *
	 * Runs inside an oRPC handler, so it throws ORPCError: oRPC turns any other
	 * error into a 500.
	 */
	async verify(token: string): Promise<DocumentVerification> {
		if (!DOCUMENT_TOKEN_PATTERN.test(token)) throw noRecord()
		const [row] = await this.verificationRows(eq(documents.verificationToken, token), 1)
		if (!row) throw noRecord()
		return this.toVerification(row)
	}

	/**
	 * The same lookup for someone without a scanner (CRT-2): the Document
	 * Number plus the code printed under the QR code. The number alone is never
	 * enough, because numbers run in sequence.
	 */
	async verifyByNumber(input: ManualVerificationInput): Promise<DocumentVerification> {
		if (!VERIFICATION_CODE_PATTERN.test(input.code)) throw noRecord()
		// Unique per document type, so a number can appear once per type at most.
		const rows = await this.verificationRows(eq(documents.documentNumber, input.documentNumber), 5)
		const row = rows.find(candidate => codeMatches(candidate.verificationToken, input.code))
		if (!row) throw noRecord()
		return this.toVerification(row)
	}

	private verificationRows(where: SQL, limit: number) {
		return db
			.select({
				documentType: documents.documentType,
				documentNumber: documents.documentNumber,
				verificationToken: documents.verificationToken,
				status: documents.status,
				issuedAt: documents.issuedAt,
				updatedAt: documents.updatedAt,
				payload: documents.payload,
				issuingLocation: locations.name,
			})
			.from(documents)
			.innerJoin(locations, eq(locations.id, documents.issuingLocationId))
			.where(where)
			.limit(limit)
	}

	private toVerification(row: {
		documentType: string
		documentNumber: string
		status: "valid" | "revoked" | "superseded"
		issuedAt: Date
		updatedAt: Date
		payload: Record<string, unknown>
		issuingLocation: string
	}): DocumentVerification {
		const type = documentTypeFor(row.documentType)
		// A type QSPS cannot describe (legacy imports, MIG-4) is out of scope here.
		if (!type) throw noRecord()
		return {
			documentType: type.type as DocumentVerification["documentType"],
			documentTitle: type.title,
			documentNumber: row.documentNumber,
			holderName: maskName(holderNameOf(row.payload)),
			issuingLocation: row.issuingLocation,
			issuedAt: row.issuedAt,
			status: row.status,
			// Revoking or superseding is the last change to a document row.
			statusChangedAt: row.status === "valid" ? null : row.updatedAt,
		}
	}

	/** The item's valid document, if it has one. */
	private async validDocumentFor(
		tx: Transaction,
		bookingItemId: number
	): Promise<DocumentSummary | null> {
		const [row] = await tx
			.select({
				id: documents.id,
				documentType: documents.documentType,
				documentNumber: documents.documentNumber,
				status: documents.status,
				issuedAt: documents.issuedAt,
				validUntil: documents.validUntil,
				serviceName: services.name,
				locationName: locations.name,
				referenceNumber: bookings.referenceNumber,
			})
			.from(documents)
			.innerJoin(bookingItems, eq(bookingItems.id, documents.bookingItemId))
			.innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.innerJoin(locations, eq(locations.id, documents.issuingLocationId))
			.where(and(eq(documents.bookingItemId, bookingItemId), eq(documents.status, "valid")))
			.limit(1)
		return row
			? { ...row, documentType: row.documentType as DocumentSummary["documentType"] }
			: null
	}

	/**
	 * Take the next number for a document type at a Location. The row is
	 * created on first use, then locked, so two officers issuing at the same
	 * moment get different numbers.
	 */
	private async nextNumber(
		tx: Transaction,
		documentType: string,
		locationId: number,
		now: Date
	): Promise<number> {
		await tx
			.insert(documentSequences)
			.values({ documentType, locationId, nextNumber: 1, createdAt: now, updatedAt: now })
			.onConflictDoNothing({
				target: [documentSequences.documentType, documentSequences.locationId],
			})

		const [row] = await tx
			.select({ id: documentSequences.id, nextNumber: documentSequences.nextNumber })
			.from(documentSequences)
			.where(
				and(
					eq(documentSequences.documentType, documentType),
					eq(documentSequences.locationId, locationId)
				)
			)
			.for("update")
		if (!row) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "No document number is available" })
		}

		await tx
			.update(documentSequences)
			.set({ nextNumber: sql`${documentSequences.nextNumber} + 1`, updatedAt: now })
			.where(eq(documentSequences.id, row.id))
		return row.nextNumber
	}

	/** The staff user's Location from `user_scopes` (same rule as processing, until ADM-2). */
	private async staffLocationId(staffId: string): Promise<number | null> {
		const [row] = await db
			.select({ locationId: userScopes.locationId })
			.from(userScopes)
			.where(and(eq(userScopes.userId, staffId), sql`${userScopes.locationId} is not null`))
			.orderBy(userScopes.id)
			.limit(1)
		return row?.locationId ?? null
	}
}
