import type { BookingItemStatus } from "@repo/contracts"

import { canOverrideItem, canTransitionItem, isTerminalItem } from "./booking-item-state"

const ALL_STATUSES: BookingItemStatus[] = [
	"booked",
	"checked_in",
	"in_assessment",
	"returned",
	"cleared",
	"pending_head_approval",
	"issued",
	"rejected",
	"no_show",
]

describe("Booking Item state machine (DOMAIN-MODEL.md 5.2)", () => {
	it.each([
		["booked", "checked_in"],
		["booked", "no_show"],
		["checked_in", "in_assessment"],
		["in_assessment", "cleared"],
		["in_assessment", "pending_head_approval"],
		["in_assessment", "returned"],
		["in_assessment", "rejected"],
		["returned", "in_assessment"],
		["pending_head_approval", "cleared"],
		["pending_head_approval", "in_assessment"],
		["cleared", "issued"],
	] as const)("allows %s -> %s", (from, to) => {
		expect(canTransitionItem(from, to)).toBe(true)
	})

	it.each([
		// Staff cannot skip check-in or assessment.
		["booked", "in_assessment"],
		["booked", "cleared"],
		["checked_in", "cleared"],
		["checked_in", "rejected"],
		// Rejected only from in_assessment, never straight from the queue.
		["booked", "rejected"],
		["returned", "cleared"],
		["cleared", "rejected"],
		["issued", "cleared"],
	] as const)("refuses %s -> %s", (from, to) => {
		expect(canTransitionItem(from, to)).toBe(false)
	})

	it("treats issued, rejected and no_show as final", () => {
		const terminal = ALL_STATUSES.filter(isTerminalItem)
		expect(terminal.sort()).toEqual(["issued", "no_show", "rejected"])
	})
})

describe("Booking Item overrides (PRC-3)", () => {
	it("lets an approver clear a rejected item", () => {
		expect(canOverrideItem("rejected", "cleared")).toBe(true)
	})

	it.each([
		["rejected", "issued"],
		["rejected", "in_assessment"],
		["cleared", "rejected"],
		["no_show", "cleared"],
		["issued", "cleared"],
	] as const)("refuses to override %s -> %s", (from, to) => {
		expect(canOverrideItem(from, to)).toBe(false)
	})

	it("keeps rejected final for the normal state machine", () => {
		expect(canTransitionItem("rejected", "cleared")).toBe(false)
		expect(isTerminalItem("rejected")).toBe(true)
	})
})
