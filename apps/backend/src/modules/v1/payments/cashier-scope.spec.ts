import { NATIONWIDE_SCOPE, type ResolvedScope } from "@/common/scope/scope-match"

import { visibleToCashier } from "./cashier-scope"

const MANILA = 2
const CEBU = 3
const CASHIER_CATEGORY = 7

/** How a cashier is normally scoped: the Cashier category at one Location. */
const manilaCashier: ResolvedScope = {
	nationwide: false,
	entries: [{ serviceCategoryId: CASHIER_CATEGORY, locationId: MANILA }],
}

describe("visibleToCashier (PAY-4)", () => {
	it("shows a booking at the cashier's Location, whatever its Service Category", () => {
		expect(visibleToCashier([{ locationId: MANILA }], manilaCashier)).toBe(true)
	})

	it("hides a booking at another Location", () => {
		expect(visibleToCashier([{ locationId: CEBU }], manilaCashier)).toBe(false)
	})

	it("shows a multi-location booking when one item is at the cashier's Location", () => {
		expect(visibleToCashier([{ locationId: CEBU }, { locationId: MANILA }], manilaCashier)).toBe(
			true
		)
	})

	it("shows nothing to a cashier with no Scope rows", () => {
		expect(visibleToCashier([{ locationId: MANILA }], { nationwide: false, entries: [] })).toBe(
			false
		)
	})

	it("shows everything to a nationwide role", () => {
		expect(visibleToCashier([{ locationId: CEBU }], NATIONWIDE_SCOPE)).toBe(true)
	})
})
