import { describe, expect, it } from "vitest"

import { checkoutItems, type CartItem } from "./cart"

function item(serviceId: number, slotId: number | null): CartItem {
	return {
		serviceId,
		serviceName: `Service ${serviceId}`,
		feeCentavos: 10000,
		locationId: 2,
		locationName: "Manila",
		slot: slotId === null ? null : ({ id: slotId } as unknown as NonNullable<CartItem["slot"]>),
	}
}

describe("checkoutItems with answers (FRM-2)", () => {
	it("sends each Service's answers with its own slot only", () => {
		const forms = new Map([[1, { formTemplateId: 11, answers: { "100": "Ana" } }]])
		expect(checkoutItems([item(1, 7), item(3, 9)], forms)).toEqual([
			{ scheduleSlotId: 7, form: { formTemplateId: 11, answers: { "100": "Ana" } } },
			{ scheduleSlotId: 9 },
		])
	})

	it("still leaves out an item waiting for a new slot", () => {
		const forms = new Map([[1, { formTemplateId: 11, answers: {} }]])
		expect(checkoutItems([item(1, null), item(3, 9)], forms)).toEqual([{ scheduleSlotId: 9 }])
	})
})
