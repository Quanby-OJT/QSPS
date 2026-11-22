import { appliesToService, versionsInEffect, type PolicyDocumentRow } from "./policy-document-rules"

jest.mock("@/common/database/database.client", () => ({ db: {} }))

function row(overrides: Partial<PolicyDocumentRow>): PolicyDocumentRow {
	return {
		id: 1,
		documentKey: "key-a",
		version: 1,
		title: "Terms of booking",
		body: "Arrive early.",
		appliesToAllServices: true,
		serviceIds: [],
		effectiveFrom: "2026-11-01",
		requiresAcceptance: true,
		withdrawnAt: null,
		createdBy: "admin-1",
		createdAt: new Date("2026-11-01T00:00:00.000Z"),
		...overrides,
	}
}

describe("versionsInEffect (ADM-9)", () => {
	it("keeps the newest version whose date has come", () => {
		const rows = [
			row({ id: 1, version: 1 }),
			row({ id: 2, version: 2, effectiveFrom: "2026-11-20" }),
		]
		expect(versionsInEffect(rows, "2026-11-22").map(r => r.id)).toEqual([2])
	})

	it("keeps the older version in force until a newer one's date", () => {
		const rows = [
			row({ id: 1, version: 1 }),
			row({ id: 2, version: 2, effectiveFrom: "2026-12-01" }),
		]
		expect(versionsInEffect(rows, "2026-11-22").map(r => r.id)).toEqual([1])
	})

	it("leaves out withdrawn policies and policies not yet in effect", () => {
		const rows = [
			row({ id: 1, withdrawnAt: new Date() }),
			row({ id: 5, documentKey: "key-b", effectiveFrom: "2026-12-01" }),
		]
		expect(versionsInEffect(rows, "2026-11-22")).toEqual([])
	})

	it("starts on the effective date itself", () => {
		expect(versionsInEffect([row({ effectiveFrom: "2026-11-22" })], "2026-11-22")).toHaveLength(1)
	})

	it("returns one version per policy, ordered by title", () => {
		const rows = [
			row({ id: 1, documentKey: "key-a", title: "Refunds" }),
			row({ id: 2, documentKey: "key-b", title: "Arrival" }),
		]
		expect(versionsInEffect(rows, "2026-11-22").map(r => r.title)).toEqual(["Arrival", "Refunds"])
	})
})

describe("appliesToService", () => {
	it("applies to every service, or only to the listed ones", () => {
		expect(appliesToService(row({}), 9)).toBe(true)
		const listed = row({ appliesToAllServices: false, serviceIds: [2, 4] })
		expect(appliesToService(listed, 4)).toBe(true)
		expect(appliesToService(listed, 9)).toBe(false)
	})
})
