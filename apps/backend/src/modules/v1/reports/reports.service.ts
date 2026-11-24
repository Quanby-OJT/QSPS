import { Injectable } from "@nestjs/common"
import { and, eq, gte, lt, sql } from "drizzle-orm"

import {
	bookingItems,
	locations,
	payments,
	receipts,
	serviceCategories,
	services,
} from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import type { ResolvedScope } from "@/common/scope/scope-match"

import { aggregateReport } from "./report-aggregation"
import { reportPeriodBounds, type ReportPeriod } from "./report-period"

@Injectable()
export class ReportsService {
	async dashboard(period: ReportPeriod, date: string, scope: ResolvedScope) {
		const { start, end } = reportPeriodBounds(period, date)

		const rows = await db
			.select({
				paymentId: payments.id,
				bookingId: payments.bookingId,
				itemId: bookingItems.id,
				// Collections are BOQ's service fees: the convenience fee goes to the
				// payment provider, so it is left out.
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
}
