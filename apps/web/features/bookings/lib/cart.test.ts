import { describe, expect, it } from "vitest"

import { MAX_BOOKING_ITEMS, type SlotAvailability } from "@repo/contracts"

import {
	canAddToCart,
	cartTotalCentavos,
	checkoutItems,
	clearCartSlot,
	isCartReady,
	removeCartItem,
	upsertCartItem,
	type CartItem,
} from "./cart"

function slot(id: number): SlotAvailability {
	return {
		id,
		startsAt: new Date("2026-12-02T00:00:00.000Z"),
		endsAt: new Date("2026-12-02T04:00:00.000Z"),
		remainingCapacity: 3,
		isAvailable: true,
	} as unknown as SlotAvailability
}

const vaccination: CartItem = {
	serviceId: 1,
	serviceName: "Yellow fever vaccination",
	feeCentavos: 150000,
	locationId: 2,
	locationName: "Manila",
	slot: slot(7),
}

const seminar: CartItem = {
	serviceId: 3,
	serviceName: "Basic hygiene seminar",
	feeCentavos: 50000,
	locationId: 4,
	locationName: "Cebu",
	slot: slot(9),
}

describe("booking cart (BKG-3)", () => {
	it("adds Services in order and totals their fees", () => {
		const cart = upsertCartItem(upsertCartItem([], vaccination), seminar)
		expect(cart.map(item => item.serviceName)).toEqual([
			"Yellow fever vaccination",
			"Basic hygiene seminar",
		])
		expect(cartTotalCentavos(cart)).toBe(200000)
		expect(checkoutItems(cart)).toEqual([{ scheduleSlotId: 7 }, { scheduleSlotId: 9 }])
	})

	it("keeps one item per Service: choosing it again replaces it in place", () => {
		const cart = upsertCartItem([vaccination, seminar], { ...vaccination, slot: slot(8) })
		expect(cart).toHaveLength(2)
		expect(cart[0]?.slot?.id).toBe(8)
	})

	it("removes one Service and leaves the rest", () => {
		expect(removeCartItem([vaccination, seminar], 1)).toEqual([seminar])
	})

	it("asks for a new slot only for the item whose slot was refused", () => {
		const cart = clearCartSlot([vaccination, seminar], 9)
		expect(cart[0]?.slot?.id).toBe(7)
		expect(cart[1]?.slot).toBeNull()
		expect(isCartReady(cart)).toBe(false)
		expect(checkoutItems(cart)).toEqual([{ scheduleSlotId: 7 }])
	})

	it("is ready only with at least one item and a slot for each", () => {
		expect(isCartReady([])).toBe(false)
		expect(isCartReady([vaccination, seminar])).toBe(true)
	})

	it("stops adding at the most services per checkout", () => {
		const full = Array.from({ length: MAX_BOOKING_ITEMS }, (_, index) => ({
			...vaccination,
			serviceId: index + 1,
		}))
		expect(canAddToCart(full.slice(1))).toBe(true)
		expect(canAddToCart(full)).toBe(false)
	})
})
