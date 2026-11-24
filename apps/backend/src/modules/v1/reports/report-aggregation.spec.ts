import type { ResolvedScope } from "@/common/scope/scope-match"

import { aggregateReport, type ReportItemRow } from "./report-aggregation"

const nationwide: ResolvedScope = { nationwide: true }

function item(overrides: Partial<ReportItemRow> = {}): ReportItemRow {
	return {
		paymentId: 1,
		bookingId: 10,
		itemId: 100,
		amountCentavos: 1001,
		feeCentavos: 100,
		locationId: 1,
		locationName: "Manila",
		serviceCategoryId: 1,
		serviceCategoryName: "Vaccination",
		...overrides,
	}
}

describe("aggregateReport", () => {
	const rows = [
		item(),
		item({
			itemId: 101,
			feeCentavos: 100,
			locationId: 2,
			locationName: "Cebu",
			serviceCategoryId: 2,
			serviceCategoryName: "Examination",
		}),
	]

	it("counts the booking once in the consolidated total", () => {
		const report = aggregateReport(rows, nationwide)

		expect(report.total).toEqual({ applicants: 1, collectionsCentavos: 1001 })
		expect(report.locations).toHaveLength(2)
		expect(report.serviceCategories).toHaveLength(2)
	})

	it("allocates every centavo deterministically", () => {
		const report = aggregateReport(rows, nationwide)

		expect(report.locations).toContainEqual({
			locationId: 1,
			locationName: "Manila",
			applicants: 1,
			collectionsCentavos: 501,
		})
		expect(report.locations).toContainEqual({
			locationId: 2,
			locationName: "Cebu",
			applicants: 1,
			collectionsCentavos: 500,
		})
	})

	it("returns only amounts and applicants inside both scope dimensions", () => {
		const scope: ResolvedScope = {
			nationwide: false,
			entries: [{ locationId: 2, serviceCategoryId: 2 }],
		}

		const report = aggregateReport(rows, scope)

		expect(report.total).toEqual({ applicants: 1, collectionsCentavos: 500 })
		expect(report.locations.map(location => location.locationId)).toEqual([2])
		expect(report.serviceCategories.map(category => category.serviceCategoryId)).toEqual([2])
	})

	it("returns nothing when no scope row matches", () => {
		const scope: ResolvedScope = {
			nationwide: false,
			entries: [{ locationId: 2, serviceCategoryId: 1 }],
		}

		expect(aggregateReport(rows, scope)).toEqual({
			total: { applicants: 0, collectionsCentavos: 0 },
			locations: [],
			serviceCategories: [],
		})
	})

	it("counts a booking once even if it has multiple payments", () => {
		const report = aggregateReport(
			[item(), item({ paymentId: 2, amountCentavos: 200 })],
			nationwide
		)

		expect(report.total).toEqual({ applicants: 1, collectionsCentavos: 1201 })
	})

	it("splits an amount equally when all service fees are zero", () => {
		const report = aggregateReport(
			[
				item({ feeCentavos: 0, amountCentavos: 3 }),
				item({
					itemId: 101,
					feeCentavos: 0,
					amountCentavos: 3,
					locationId: 2,
					locationName: "Cebu",
				}),
			],
			nationwide
		)

		expect(report.total.collectionsCentavos).toBe(3)
		expect(report.locations.find(location => location.locationId === 1)?.collectionsCentavos).toBe(
			2
		)
	})
})