import { describe, expect, it } from "vitest"

import {
	actorLabel,
	auditQueryString,
	draftToFilter,
	EMPTY_AUDIT_DRAFT,
	formatAuditValue,
	rangeIsBackwards,
	targetLabel,
} from "./filters"

describe("draftToFilter", () => {
	it("sends nothing for an empty form", () => {
		expect(draftToFilter(EMPTY_AUDIT_DRAFT)).toEqual({})
	})

	it("trims values and leaves out blank fields and 'all'", () => {
		expect(
			draftToFilter({
				...EMPTY_AUDIT_DRAFT,
				actor: "  admin@qsps.local ",
				action: "role.",
				targetId: "   ",
				outcome: "all",
			})
		).toEqual({ actor: "admin@qsps.local", action: "role." })
	})

	it("keeps the outcome when one is chosen", () => {
		expect(draftToFilter({ ...EMPTY_AUDIT_DRAFT, outcome: "denied" })).toEqual({
			outcome: "denied",
		})
	})
})

describe("rangeIsBackwards", () => {
	it("is true only when the end date is before the start date", () => {
		expect(rangeIsBackwards({ from: "2026-11-21", to: "2026-11-20" })).toBe(true)
		expect(rangeIsBackwards({ from: "2026-11-21", to: "2026-11-21" })).toBe(false)
		expect(rangeIsBackwards({ from: "2026-11-21" })).toBe(false)
	})
})

describe("auditQueryString", () => {
	it("encodes values and skips empty ones", () => {
		expect(auditQueryString({ actor: "a b", limit: 50, role: undefined, domain: "" })).toBe(
			"?actor=a+b&limit=50"
		)
		expect(auditQueryString({})).toBe("")
	})
})

describe("labels", () => {
	it("names the System when there is no actor", () => {
		expect(actorLabel({ actorEmail: null, actorId: null })).toBe("System")
		expect(actorLabel({ actorEmail: null, actorId: "u1" })).toBe("u1")
		expect(actorLabel({ actorEmail: "a@b.c", actorId: "u1" })).toBe("a@b.c")
	})

	it("shows the target type and id", () => {
		expect(targetLabel({ targetType: "user", targetId: "u1" })).toBe("user: u1")
		expect(targetLabel({ targetType: "audit_log", targetId: null })).toBe("audit_log")
		expect(targetLabel({ targetType: null, targetId: null })).toBe("—")
	})

	it("prints JSON values indented", () => {
		expect(formatAuditValue({ roleHeld: true })).toBe('{\n  "roleHeld": true\n}')
		expect(formatAuditValue(null)).toBe("—")
		expect(formatAuditValue("text")).toBe("text")
	})
})