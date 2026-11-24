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
}