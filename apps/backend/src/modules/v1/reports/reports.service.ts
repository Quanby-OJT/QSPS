import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import {
	and,
	asc,
	desc,
	eq,
	exists,
	gte,
	ilike,
	inArray,
	lt,
	or,
	sql,
	type SQL,
} from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import {
	auditLog,
	bookingItems,
	bookings,
	documents,
	locations,
	payments,
	receipts,
	scheduleSlots,
	serviceCategories,
	services,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { ExportService } from "@/common/export/export.service"
import { ScopeService } from "@/common/scope/scope.service"
import { inScope, scopeCondition, type ResolvedScope } from "@/common/scope/scope-match"

import { aggregateReport } from "./report-aggregation"
import { reportPeriodBounds, type ReportPeriod } from "./report-period"

type TransactionFilters = {
	search?: string
	dateFrom?: string
	dateTo?: string
	locationId?: number
	serviceCategoryId?: number
	status?: string
	channel?: string
	actor?: string
}

type TransactionExportFilters = TransactionFilters & {
	format: "csv" | "pdf"
}

type TransactionListQuery = TransactionFilters & {
	page: number
	pageSize: number
}
function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, match => `\\${match}`)
}

function manilaStart(date: string): Date {
	return new Date(`${date}T00:00:00+08:00`)
}

function nextManilaStart(date: string): Date {
	return new Date(manilaStart(date).getTime() + 24 * 60 * 60 * 1000)
}

function positiveIds(values: (string | null)[]): number[] {
	return [...new Set(values.map(Number).filter(value => Number.isSafeInteger(value) && value > 0))]
}

@Injectable()
export class ReportsService {
	constructor(
		private readonly scopeService: ScopeService,
		private readonly exportService: ExportService,
		private readonly auditService: AuditService
	) {}

	async dashboard(period: ReportPeriod, date: string, scope: ResolvedScope) {
		const { start, end } = reportPeriodBounds(period, date)

		const rows = await db
			.select({
				paymentId: payments.id,
				bookingId: payments.bookingId,
				itemId: bookingItems.id,
				amountCentavos:
					sql<number>`(${payments.amountCentavos} - ${payments.convenienceFeeCentavos})`.mapWith(
						Number
					),
				feeCentavos: bookingItems.feeCentavos,
				locationId: locations.id,
				locationName: locations.name,
				serviceCategoryId: serviceCategories.id,
				serviceCategoryName: serviceCategories.name,
			})
			.from(payments)
			.innerJoin(receipts, eq(receipts.paymentId, payments.id))
			.innerJoin(bookingItems, eq(bookingItems.bookingId, payments.bookingId))
			.innerJoin(locations, eq(locations.id, bookingItems.locationId))
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.innerJoin(serviceCategories, eq(serviceCategories.id, services.serviceCategoryId))
			.where(
				and(
					eq(payments.status, "succeeded"),
					gte(receipts.issuedAt, start),
					lt(receipts.issuedAt, end)
				)
			)

		return {
			period,
			date,
			start: start.toISOString(),
			end: end.toISOString(),
			...aggregateReport(rows, scope),
		}
	}

	async listTransactions(input: TransactionListQuery, scope: ResolvedScope) {
		const conditions = await this.transactionConditions(input, scope)
		const where = and(...conditions)

		const [countRow] = await db
			.select({ total: sql<number>`count(*)`.mapWith(Number) })
			.from(bookings)
			.innerJoin(users, eq(users.id, bookings.clientId))
			.where(where)

		const pageRows = await db
			.select({
				bookingId: bookings.id,
				referenceNumber: bookings.referenceNumber,
				clientName: users.name,
				clientEmail: users.email,
				status: bookings.status,
				kind: bookings.kind,
				totalCentavos: bookings.totalCentavos,
				createdAt: bookings.createdAt,
				updatedAt: bookings.updatedAt,
				createdBy: bookings.createdBy,
			})
			.from(bookings)
			.innerJoin(users, eq(users.id, bookings.clientId))
			.where(where)
			.orderBy(desc(bookings.createdAt), desc(bookings.id))
			.limit(input.pageSize)
			.offset((input.page - 1) * input.pageSize)

		const ids = pageRows.map(row => row.bookingId)
		if (ids.length === 0) {
			return {
				page: input.page,
				pageSize: input.pageSize,
				total: countRow?.total ?? 0,
				rows: [],
			}
		}

		const itemRows = await db
			.select({ bookingId: bookingItems.bookingId })
			.from(bookingItems)
			.where(inArray(bookingItems.bookingId, ids))

		const itemCounts = new Map<number, number>()
		for (const row of itemRows) {
			itemCounts.set(row.bookingId, (itemCounts.get(row.bookingId) ?? 0) + 1)
		}

		const paymentRows = await db
			.select({
				bookingId: payments.bookingId,
				status: payments.status,
				channel: payments.channelCode,
				createdAt: payments.createdAt,
				receiptNumber: receipts.receiptNumber,
			})
			.from(payments)
			.leftJoin(receipts, eq(receipts.paymentId, payments.id))
			.where(inArray(payments.bookingId, ids))
			.orderBy(desc(payments.createdAt), desc(payments.id))

		const latestPayment = new Map<
			number,
			{
				status: string
				channel: string
				createdAt: Date
				receiptNumber: string | null
			}
		>()
		for (const row of paymentRows) {
			if (!latestPayment.has(row.bookingId)) {
				latestPayment.set(row.bookingId, {
					status: row.status,
					channel: row.channel,
					createdAt: row.createdAt,
					receiptNumber: row.receiptNumber,
				})
			}
		}

		const creatorIds = [...new Set(pageRows.map(row => row.createdBy))]
		const creatorRows =
			creatorIds.length > 0
				? await db
						.select({ id: users.id, name: users.name })
						.from(users)
						.where(inArray(users.id, creatorIds))
				: []
		const creatorNames = new Map(creatorRows.map(row => [row.id, row.name]))

		return {
			page: input.page,
			pageSize: input.pageSize,
			total: countRow?.total ?? 0,
			rows: pageRows.map(row => {
				const payment = latestPayment.get(row.bookingId)
				return {
					bookingId: row.bookingId,
					referenceNumber: row.referenceNumber,
					clientName: row.clientName,
					clientEmail: row.clientEmail,
					status: row.status,
					kind: row.kind,
					totalCentavos: row.totalCentavos,
					createdAt: row.createdAt.toISOString(),
					serviceCount: itemCounts.get(row.bookingId) ?? 0,
					latestPaymentStatus: payment?.status ?? null,
					latestChannel: payment?.channel ?? null,
					latestReceiptNumber: payment?.receiptNumber ?? null,
					lastActivityAt: (payment?.createdAt ?? row.updatedAt).toISOString(),
					lastActor: creatorNames.get(row.createdBy) ?? null,
				}
			}),
		}
	}

	async transactionDetail(id: number, userId: string, scope: ResolvedScope) {
		const [booking] = await db
			.select({
				id: bookings.id,
				referenceNumber: bookings.referenceNumber,
				clientName: users.name,
				clientEmail: users.email,
				status: bookings.status,
				kind: bookings.kind,
				totalCentavos: bookings.totalCentavos,
				createdAt: bookings.createdAt,
				updatedAt: bookings.updatedAt,
			})
			.from(bookings)
			.innerJoin(users, eq(users.id, bookings.clientId))
			.where(eq(bookings.id, id))
			.limit(1)

		if (!booking) {
			throw new ORPCError("NOT_FOUND", { message: "Booking not found" })
		}

		const allItems = await db
			.select({
				id: bookingItems.id,
				serviceId: bookingItems.serviceId,
				serviceName: services.name,
				serviceCategoryId: services.serviceCategoryId,
				serviceCategoryName: serviceCategories.name,
				locationId: bookingItems.locationId,
				locationName: locations.name,
				startsAt: scheduleSlots.startsAt,
				endsAt: scheduleSlots.endsAt,
				status: bookingItems.status,
				feeCentavos: bookingItems.feeCentavos,
			})
			.from(bookingItems)
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.innerJoin(serviceCategories, eq(serviceCategories.id, services.serviceCategoryId))
			.innerJoin(locations, eq(locations.id, bookingItems.locationId))
			.innerJoin(scheduleSlots, eq(scheduleSlots.id, bookingItems.scheduleSlotId))
			.where(eq(bookingItems.bookingId, id))

		const visibleItems = allItems.filter(item =>
			inScope(scope, {
				serviceCategoryId: item.serviceCategoryId,
				locationId: item.locationId,
			})
		)

		if (visibleItems.length === 0) {
			await this.scopeService.assert(
				userId,
				allItems.map(item => ({
					serviceCategoryId: item.serviceCategoryId,
					locationId: item.locationId,
				})),
				{ type: "booking", id, notFoundMessage: "Booking not found" }
			)
		}

		const itemIds = visibleItems.map(item => item.id)
		const collector = alias(users, "transaction_collector")

		const paymentRows = await db
			.select({
				id: payments.id,
				status: payments.status,
				channelCode: payments.channelCode,
				providerCode: payments.providerCode,
				providerReference: payments.providerReference,
				amountCentavos: payments.amountCentavos,
				convenienceFeeCentavos: payments.convenienceFeeCentavos,
				needsReview: payments.needsReview,
				collectedByName: collector.name,
				tenderType: payments.tenderType,
				createdAt: payments.createdAt,
				receiptNumber: receipts.receiptNumber,
			})
			.from(payments)
			.leftJoin(receipts, eq(receipts.paymentId, payments.id))
			.leftJoin(collector, eq(collector.id, payments.collectedBy))
			.where(eq(payments.bookingId, id))
			.orderBy(asc(payments.createdAt), asc(payments.id))

		const documentRows =
			itemIds.length > 0
				? await db
						.select({
							id: documents.id,
							bookingItemId: documents.bookingItemId,
							documentType: documents.documentType,
							documentNumber: documents.documentNumber,
							issuingLocation: locations.name,
							status: documents.status,
							issuedAt: documents.issuedAt,
							validUntil: documents.validUntil,
							source: documents.source,
						})
						.from(documents)
						.innerJoin(locations, eq(locations.id, documents.issuingLocationId))
						.where(inArray(documents.bookingItemId, itemIds))
						.orderBy(asc(documents.issuedAt), asc(documents.id))
				: []

		const paymentIds = paymentRows.map(row => String(row.id))
		const receiptNumbers = paymentRows
			.map(row => row.receiptNumber)
			.filter((value): value is string => value !== null)
		const documentIds = documentRows.map(row => String(row.id))
		const itemTargetIds = itemIds.map(String)
		const targetConditions: SQL[] = [
			and(eq(auditLog.targetType, "booking"), eq(auditLog.targetId, String(id)))!,
		]
		if (itemTargetIds.length > 0) {
			targetConditions.push(
				and(
					eq(auditLog.targetType, "booking_item"),
					inArray(auditLog.targetId, itemTargetIds)
				)!
			)
		}
		if (paymentIds.length > 0) {
			targetConditions.push(
				and(eq(auditLog.targetType, "payment"), inArray(auditLog.targetId, paymentIds))!
			)
		}
		if (receiptNumbers.length > 0) {
			// Receipt audit targets use the receipt row id, which is included below.
			const receiptRows = await db
				.select({ id: receipts.id })
				.from(receipts)
				.innerJoin(payments, eq(payments.id, receipts.paymentId))
				.where(eq(payments.bookingId, id))
			const receiptIds = receiptRows.map(row => String(row.id))
			if (receiptIds.length > 0) {
				targetConditions.push(
					and(eq(auditLog.targetType, "receipt"), inArray(auditLog.targetId, receiptIds))!
				)
			}
		}
		if (documentIds.length > 0) {
			targetConditions.push(
				and(eq(auditLog.targetType, "document"), inArray(auditLog.targetId, documentIds))!
			)
		}

		const timeline = await db
			.select({
				id: auditLog.id,
				domain: auditLog.domain,
				action: auditLog.action,
				outcome: auditLog.outcome,
				actorId: auditLog.actorId,
				actorEmail: users.email,
				actorRole: auditLog.actorRole,
				targetType: auditLog.targetType,
				targetId: auditLog.targetId,
				oldValue: auditLog.oldValue,
				newValue: auditLog.newValue,
				reason: auditLog.reason,
				createdAt: auditLog.createdAt,
			})
			.from(auditLog)
			.leftJoin(users, eq(users.id, auditLog.actorId))
			.where(or(...targetConditions))
			.orderBy(asc(auditLog.id))

		return {
			booking: {
				...booking,
				createdAt: booking.createdAt.toISOString(),
				updatedAt: booking.updatedAt.toISOString(),
			},
			items: visibleItems.map(item => ({
				id: item.id,
				serviceName: item.serviceName,
				serviceCategoryName: item.serviceCategoryName,
				locationName: item.locationName,
				startsAt: item.startsAt.toISOString(),
				endsAt: item.endsAt.toISOString(),
				status: item.status,
				feeCentavos: item.feeCentavos,
			})),
			payments: paymentRows.map(row => ({
				id: row.id,
				status: row.status,
				channelCode: row.channelCode,
				providerCode: row.providerCode,
				providerReference: row.providerReference,
				amountCentavos: row.amountCentavos,
				convenienceFeeCentavos: row.convenienceFeeCentavos,
				needsReview: row.needsReview,
				collectedBy: row.collectedByName,
				tenderType: row.tenderType,
				createdAt: row.createdAt.toISOString(),
				receiptNumber: row.receiptNumber,
			})),
			documents: documentRows.map(row => ({
				...row,
				issuedAt: row.issuedAt.toISOString(),
			})),
			timeline: timeline.map(row => ({
				...row,
				createdAt: row.createdAt.toISOString(),
			})),
		}
	}

	async exportTransactions(filters: TransactionExportFilters,scope: ResolvedScope,actorId: string) {
		const conditions = await this.transactionConditions(filters, scope)
		const rows = await db
			.select({
				referenceNumber: bookings.referenceNumber,
				clientName: users.name,
				clientEmail: users.email,
				status: bookings.status,
				kind: bookings.kind,
				totalCentavos: bookings.totalCentavos,
				createdAt: bookings.createdAt,
			})
			.from(bookings)
			.innerJoin(users, eq(users.id, bookings.clientId))
			.where(and(...conditions))
			.orderBy(desc(bookings.createdAt), desc(bookings.id))

		const exported = await this.exportService.exportTable({
			format: filters.format as "csv" | "pdf",
			fileBaseName: `qsps-transactions-${new Date().toISOString().slice(0, 10)}`,
			title: "QSPS Transaction Monitor",
			columns: [
				{ key: "referenceNumber", header: "Reference Number" },
				{ key: "clientName", header: "Client" },
				{ key: "clientEmail", header: "Client Email" },
				{ key: "status", header: "Booking Status" },
				{ key: "kind", header: "Booking Kind" },
				{ key: "totalCentavos", header: "Total (centavos)" },
				{ key: "createdAt", header: "Created At (UTC)" },
			],
			rows,
		})

		await this.auditService.record({
			domain: "reports",
			action: "transactions.export",
			actorId,
			targetType: "booking_filter",
			newValue: {
				format: filters.format,
				filters: this.auditSafeFilters(filters),
				rowCount: rows.length,
			},
		})

		return {
			fileName: exported.fileName,
			mimeType: exported.mimeType,
			contentBase64: exported.buffer.toString("base64"),
			rowCount: rows.length,
		}
	}

	private async transactionConditions(
		filters: TransactionFilters,
		scope: ResolvedScope
	): Promise<SQL[]> {
		const conditions: SQL[] = []
		const scopedItemCondition = scopeCondition(scope, {
			serviceCategoryId: services.serviceCategoryId,
			locationId: bookingItems.locationId,
		})

		const itemConditions: SQL[] = [eq(bookingItems.bookingId, bookings.id)]
		if (scopedItemCondition) itemConditions.push(scopedItemCondition)
		if (filters.locationId) itemConditions.push(eq(bookingItems.locationId, filters.locationId))
		if (filters.serviceCategoryId) {
			itemConditions.push(eq(services.serviceCategoryId, filters.serviceCategoryId))
		}
		const itemExists = exists(
			db
				.select({ id: bookingItems.id })
				.from(bookingItems)
				.innerJoin(services, eq(services.id, bookingItems.serviceId))
				.where(and(...itemConditions))
		)
		conditions.push(itemExists)

		if (filters.search) {
			const pattern = `%${escapeLike(filters.search)}%`
			const receiptMatch = exists(
				db
					.select({ id: receipts.id })
					.from(receipts)
					.innerJoin(payments, eq(payments.id, receipts.paymentId))
					.where(
						and(
							eq(payments.bookingId, bookings.id),
							ilike(receipts.receiptNumber, pattern)
						)
					)
			)
			const match = or(
				ilike(bookings.referenceNumber, pattern),
				ilike(users.name, pattern),
				ilike(users.email, pattern),
				receiptMatch
			)
			if (match) conditions.push(match)
		}

		if (filters.dateFrom) {
			conditions.push(gte(bookings.createdAt, manilaStart(filters.dateFrom)))
		}
		if (filters.dateTo) {
			conditions.push(lt(bookings.createdAt, nextManilaStart(filters.dateTo)))
		}

		if (filters.status) {
			const paymentStatusMatch = exists(
				db
					.select({ id: payments.id })
					.from(payments)
					.where(
						and(
							eq(payments.bookingId, bookings.id),
							eq(
								payments.status,
								filters.status as (typeof payments.$inferSelect)["status"]
							)
						)
					)
			)

			const statusMatch = or(
				eq(
					bookings.status,
					filters.status as (typeof bookings.$inferSelect)["status"]
				),
				paymentStatusMatch
			)
			if (statusMatch) conditions.push(statusMatch)
		}

		if (filters.channel) {
			conditions.push(
				exists(
					db
						.select({ id: payments.id })
						.from(payments)
						.where(
							and(
								eq(payments.bookingId, bookings.id),
								eq(payments.channelCode, filters.channel)
							)
						)
				)
			)
		}

		if (filters.actor) {
			const matchingUsers = await db
				.select({ id: users.id })
				.from(users)
				.where(
					or(
						eq(users.id, filters.actor),
						ilike(users.email, `%${escapeLike(filters.actor)}%`),
						ilike(users.name, `%${escapeLike(filters.actor)}%`)
					)
				)
			const actorIds = matchingUsers.map(row => row.id)
			if (actorIds.length === 0) {
				conditions.push(sql`false`)
			} else {
				const events = await db
					.select({ targetType: auditLog.targetType, targetId: auditLog.targetId })
					.from(auditLog)
					.where(inArray(auditLog.actorId, actorIds))

				const bookingIds = positiveIds(
					events
						.filter(row => row.targetType === "booking")
						.map(row => row.targetId)
				)
				const itemIds = positiveIds(
					events
						.filter(row => row.targetType === "booking_item")
						.map(row => row.targetId)
				)
				const paymentIds = positiveIds(
					events.filter(row => row.targetType === "payment").map(row => row.targetId)
				)
				const receiptIds = positiveIds(
					events.filter(row => row.targetType === "receipt").map(row => row.targetId)
				)
				const documentIds = positiveIds(
					events.filter(row => row.targetType === "document").map(row => row.targetId)
				)

				const matchedBookingIds = new Set<number>(bookingIds)
				if (itemIds.length > 0) {
					const linked = await db
						.select({ bookingId: bookingItems.bookingId })
						.from(bookingItems)
						.where(inArray(bookingItems.id, itemIds))
					for (const row of linked) matchedBookingIds.add(row.bookingId)
				}
				if (paymentIds.length > 0) {
					const linked = await db
						.select({ bookingId: payments.bookingId })
						.from(payments)
						.where(inArray(payments.id, paymentIds))
					for (const row of linked) matchedBookingIds.add(row.bookingId)
				}
				if (receiptIds.length > 0) {
					const linked = await db
						.select({ bookingId: payments.bookingId })
						.from(receipts)
						.innerJoin(payments, eq(payments.id, receipts.paymentId))
						.where(inArray(receipts.id, receiptIds))
					for (const row of linked) matchedBookingIds.add(row.bookingId)
				}
				if (documentIds.length > 0) {
					const linked = await db
						.select({ bookingId: bookingItems.bookingId })
						.from(documents)
						.innerJoin(bookingItems, eq(bookingItems.id, documents.bookingItemId))
						.where(inArray(documents.id, documentIds))
					for (const row of linked) matchedBookingIds.add(row.bookingId)
				}

				const ids = [...matchedBookingIds]
				conditions.push(ids.length > 0 ? inArray(bookings.id, ids) : sql`false`)
			}
		}

		return conditions
	}

	private auditSafeFilters(filters: TransactionFilters): TransactionFilters {
		return {
			...filters,
			actor: filters.actor ? "[filtered]" : undefined,
		}
	}
}