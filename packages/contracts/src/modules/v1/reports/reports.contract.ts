import { oc } from "@orpc/contract"
import { z } from "zod"

const ReportPeriodSchema = z.enum(["day", "week", "month", "year"])

const ReportDateSchema = z.string().refine(value => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
	if (!match) return false

	const year = Number(match[1])
	const month = Number(match[2])
	const day = Number(match[3])

	if (year < 1900 || year > 9998) return false

	const date = new Date(Date.UTC(year, month - 1, day))
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	)
}, "Enter a valid date in YYYY-MM-DD format")

const ReportQuerySchema = z.object({
	period: ReportPeriodSchema,
	date: ReportDateSchema,
})

const ReportTotalsSchema = z.object({
	applicants: z.number().int().nonnegative(),
	collectionsCentavos: z.number().int().nonnegative(),
})

const ReportLocationSchema = ReportTotalsSchema.extend({
	locationId: z.number().int().positive(),
	locationName: z.string(),
})

const ReportCategorySchema = ReportTotalsSchema.extend({
	serviceCategoryId: z.number().int().positive(),
	serviceCategoryName: z.string(),
})

const DashboardReportSchema = z.object({
	period: ReportPeriodSchema,
	date: ReportDateSchema,
	start: z.string(),
	end: z.string(),
	total: ReportTotalsSchema,
	locations: z.array(ReportLocationSchema),
	serviceCategories: z.array(ReportCategorySchema),
})

const TransactionFiltersSchema = z.object({
	search: z.string().trim().min(1).max(200).optional(),
	dateFrom: ReportDateSchema.optional(),
	dateTo: ReportDateSchema.optional(),
	locationId: z.coerce.number().int().positive().optional(),
	serviceCategoryId: z.coerce.number().int().positive().optional(),
	status: z
		.enum([
			"pending_approval",
			"pending_payment",
			"paid",
			"completed",
			"cancelled",
			"rejected",
			"forfeited",
			"refund_requested",
			"refunded",
			"initiated",
			"pending",
			"succeeded",
			"failed",
			"expired",
		])
		.optional(),
	channel: z.string().trim().min(1).max(80).optional(),
	actor: z.string().trim().min(1).max(255).optional(),
})
const ListTransactionsInputSchema = TransactionFiltersSchema.extend({
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

const TransactionListRowSchema = z.object({
	bookingId: z.number().int().positive(),
	referenceNumber: z.string(),
	clientName: z.string(),
	clientEmail: z.string(),
	status: z.string(),
	kind: z.string(),
	totalCentavos: z.number().int().nonnegative(),
	createdAt: z.string(),
	serviceCount: z.number().int().nonnegative(),
	latestPaymentStatus: z.string().nullable(),
	latestChannel: z.string().nullable(),
	latestReceiptNumber: z.string().nullable(),
	lastActivityAt: z.string().nullable(),
	lastActor: z.string().nullable(),
})

const ListTransactionsResponseSchema = z.object({
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
	total: z.number().int().nonnegative(),
	rows: z.array(TransactionListRowSchema),
})

const TransactionIdSchema = z.object({
	id: z.coerce.number().int().positive(),
})

const TransactionDetailResponseSchema = z.object({
	booking: z.object({
		id: z.number().int().positive(),
		referenceNumber: z.string(),
		clientName: z.string(),
		clientEmail: z.string(),
		status: z.string(),
		kind: z.string(),
		totalCentavos: z.number().int().nonnegative(),
		createdAt: z.string(),
		updatedAt: z.string(),
	}),
	items: z.array(
		z.object({
			id: z.number().int().positive(),
			serviceName: z.string(),
			serviceCategoryName: z.string(),
			locationName: z.string(),
			startsAt: z.string(),
			endsAt: z.string(),
			status: z.string(),
			feeCentavos: z.number().int().nonnegative(),
		})
	),
	payments: z.array(
		z.object({
			id: z.number().int().positive(),
			status: z.string(),
			channelCode: z.string(),
			providerCode: z.string(),
			providerReference: z.string().nullable(),
			amountCentavos: z.number().int().nonnegative(),
			convenienceFeeCentavos: z.number().int().nonnegative(),
			needsReview: z.boolean(),
			collectedBy: z.string().nullable(),
			tenderType: z.string().nullable(),
			createdAt: z.string(),
			receiptNumber: z.string().nullable(),
		})
	),
	documents: z.array(
		z.object({
			id: z.number().int().positive(),
			bookingItemId: z.number().int().positive().nullable(),
			documentType: z.string(),
			documentNumber: z.string(),
			issuingLocation: z.string(),
			status: z.string(),
			issuedAt: z.string(),
			validUntil: z.string().nullable(),
			source: z.string(),
		})
	),
	timeline: z.array(
		z.object({
			id: z.number().int().positive(),
			domain: z.string(),
			action: z.string(),
			outcome: z.string(),
			actorId: z.string().nullable(),
			actorEmail: z.string().nullable(),
			actorRole: z.string().nullable(),
			targetType: z.string().nullable(),
			targetId: z.string().nullable(),
			oldValue: z.unknown().nullable(),
			newValue: z.unknown().nullable(),
			reason: z.string().nullable(),
			createdAt: z.string(),
		})
	),
})

const ExportTransactionsInputSchema = TransactionFiltersSchema.extend({
	format: z.enum(["csv", "pdf"]),
})

const ExportTransactionsResponseSchema = z.object({
	fileName: z.string(),
	mimeType: z.string(),
	contentBase64: z.string(),
	rowCount: z.number().int().nonnegative(),
})

export const reportsContract = {
	dashboard: oc
		.route({
			method: "GET",
			path: "/reports/dashboard",
			summary: "Read applicants and collections for a period",
			description:
				"Returns an Asia/Manila period report limited to the caller's Location and Service Category Scope.",
			tags: ["Reports"],
		})
		.input(ReportQuerySchema)
		.output(DashboardReportSchema),

	listTransactions: oc
		.route({
			method: "GET",
			path: "/reports/transactions",
			summary: "Search and filter Bookings and Payments",
			tags: ["Reports"],
		})
		.input(ListTransactionsInputSchema)
		.output(ListTransactionsResponseSchema),

	exportTransactions: oc
		.route({
			method: "GET",
			path: "/reports/transactions/export",
			summary: "Export filtered Bookings and Payments",
			tags: ["Reports"],
		})
		.input(ExportTransactionsInputSchema)
		.output(ExportTransactionsResponseSchema),

	transactionDetail: oc
		.route({
			method: "GET",
			path: "/reports/transactions/{id}",
			summary: "Read a Booking, its items, Payments, Documents and audit timeline",
			tags: ["Reports"],
		})
		.input(TransactionIdSchema)
		.output(TransactionDetailResponseSchema),
}
