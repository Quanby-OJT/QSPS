import { matchesAuditFilter, toArchivedEntry, type ArchivedAuditRow } from "./audit-archive-rules"

const row: ArchivedAuditRow = {
	id: 7,
	domain: "rbac",
	action: "role.assign",
	outcome: "success",
	actorId: "u1",
	actorRole: "Super Admin",
	targetType: "user",
	targetId: "u2",
	oldValue: null,
	newValue: { role: "Cashier" },
	reason: null,
	ipAddress: "127.0.0.1",
	userAgent: "test",
	prevHash: "a",
	entryHash: "b",
	// 21 Nov 2026, 00:30 in Manila.
	createdAt: "2026-11-20T16:30:00.000Z",
}
const entry = toArchivedEntry(row, "Admin@QSPS.local")

describe("matchesAuditFilter", () => {
	it("matches with no filters, and marks the entry archived", () => {
		expect(matchesAuditFilter(entry, {})).toBe(true)
		expect(entry.archived).toBe(true)
	})
	it("reads from and to as Manila days, both included", () => {
		expect(matchesAuditFilter(entry, { from: "2026-11-21", to: "2026-11-21" })).toBe(true)
		expect(matchesAuditFilter(entry, { to: "2026-11-20" })).toBe(false)
		expect(matchesAuditFilter(entry, { from: "2026-11-22" })).toBe(false)
	})
	it("finds the actor by part of the email, any case, or by id; system means no actor", () => {
		expect(matchesAuditFilter(entry, { actor: "admin@qsps" })).toBe(true)
		expect(matchesAuditFilter(entry, { actor: "u1" })).toBe(true)
		expect(matchesAuditFilter(entry, { actor: "system" })).toBe(false)
	})
	it("matches the action from the start and the other filters exactly", () => {
		expect(matchesAuditFilter(entry, { action: "role." })).toBe(true)
		expect(matchesAuditFilter(entry, { action: "assign" })).toBe(false)
		expect(matchesAuditFilter(entry, { domain: "rbac", outcome: "success", role: "super" })).toBe(
			true
		)
		expect(matchesAuditFilter(entry, { outcome: "denied" })).toBe(false)
		expect(matchesAuditFilter(entry, { targetType: "user", targetId: "u2" })).toBe(true)
	})
})
