import { describe, expect, it } from "vitest"

import type { PolicyDocument } from "@repo/contracts"

import {
	appliesToLabel,
	draftFrom,
	emptyDraft,
	manilaToday,
	missingAcceptances,
	parsePolicyDraft,
	policyParagraphs,
	stateLabel,
} from "./policy-documents"

/** Sunday 22 November 2026, 14:00 in Manila. */
const NOW = new Date("2026-11-22T06:00:00.000Z")

const policy: PolicyDocument = {
	id: 4,
	documentKey: "3f1c2b7e-8a4d-4e5f-9b6a-0c1d2e3f4a5b",
	version: 2,
	title: "Terms of booking",
	body: "Arrive early.\n\nBring a valid ID.",
	requiresAcceptance: true,
	effectiveFrom: "2026-11-01",
	appliesToAllServices: false,
	serviceNames: ["Yellow fever vaccination", "MMR"],
	serviceIds: [2, 3],
	state: "in_effect",
	olderVersionInEffect: false,
	withdrawnAt: null,
	createdAt: NOW,
	createdByEmail: "admin@qsps.local",
}

describe("policy documents (ADM-9)", () => {
	it("uses the Manila date, which is already tomorrow after 16:00 UTC", () => {
		expect(manilaToday(NOW)).toBe("2026-11-22")
		expect(manilaToday(new Date("2026-11-22T16:30:00.000Z"))).toBe("2026-11-23")
	})

	it("splits the text into paragraphs at blank lines", () => {
		expect(policyParagraphs("One.\n\n  Two.\r\n\r\nThree.\n")).toEqual(["One.", "Two.", "Three."])
	})

	it("names what the policy applies to", () => {
		expect(appliesToLabel(policy)).toBe("Yellow fever vaccination, MMR")
		expect(appliesToLabel({ ...policy, appliesToAllServices: true, serviceNames: [] })).toBe(
			"All services"
		)
	})

	it("says when a scheduled version starts", () => {
		expect(stateLabel(policy)).toBe("In effect")
		expect(stateLabel({ ...policy, state: "scheduled", effectiveFrom: "2026-12-01" })).toMatch(
			/^Starts .*December.*2026$/
		)
		expect(stateLabel({ ...policy, state: "withdrawn" })).toBe("Withdrawn")
	})

	it("starts a new version from the current one, dated today at the earliest", () => {
		expect(draftFrom(policy, NOW)).toMatchObject({
			title: "Terms of booking",
			serviceIds: [2, 3],
			effectiveFrom: "2026-11-22",
		})
	})

	it("checks a draft with the API's rules and refuses a past date", () => {
		expect(parsePolicyDraft({ ...emptyDraft(NOW), title: "T", body: "B" }, NOW).ok).toBe(true)
		expect(parsePolicyDraft(emptyDraft(NOW), NOW)).toEqual({ ok: false, message: "Enter a title" })
		expect(
			parsePolicyDraft(
				{ ...emptyDraft(NOW), title: "T", body: "B", effectiveFrom: "2026-11-21" },
				NOW
			)
		).toEqual({ ok: false, message: "The effective date cannot be in the past" })
	})

	it("lists the policies still to accept", () => {
		const reading = { ...policy, id: 5, requiresAcceptance: false }
		expect(missingAcceptances([policy, reading], new Set()).map(p => p.id)).toEqual([4])
		expect(missingAcceptances([policy, reading], new Set([4]))).toEqual([])
	})
})
