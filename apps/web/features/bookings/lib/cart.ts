import {
	MAX_BOOKING_ITEMS,
	type BookingItemFormInput,
	type CreateBookingItemInput,
	type SlotAvailability,
} from "@repo/contracts"

/**
 * One Service in the booking wizard's cart (BKG-3). A Service appears at most
 * once, so its id is the item's key. `slot` is null when the slot the client
 * had chosen was taken or closed and they must choose a new one.
 */
export interface CartItem {
	serviceId: number
	serviceName: string
	feeCentavos: number
	locationId: number
	locationName: string
	slot: SlotAvailability | null
}

/** Adds the item, or replaces the cart's item for the same Service. */
export function upsertCartItem(cart: readonly CartItem[], item: CartItem): CartItem[] {
	const index = cart.findIndex(existing => existing.serviceId === item.serviceId)
	if (index === -1) return [...cart, item]
	return cart.map((existing, position) => (position === index ? item : existing))
}

export function removeCartItem(cart: readonly CartItem[], serviceId: number): CartItem[] {
	return cart.filter(item => item.serviceId !== serviceId)
}

/** The item whose slot was refused keeps its place in the cart but needs a new slot. */
export function clearCartSlot(cart: readonly CartItem[], scheduleSlotId: number): CartItem[] {
	return cart.map(item => (item.slot?.id === scheduleSlotId ? { ...item, slot: null } : item))
}

/** The review total: the sum of each Service's fee, as the API computes it. */
export function cartTotalCentavos(cart: readonly CartItem[]): number {
	return cart.reduce((sum, item) => sum + item.feeCentavos, 0)
}

/** Every item has a slot, and there is at least one. */
export function isCartReady(cart: readonly CartItem[]): boolean {
	return cart.length > 0 && cart.every(item => item.slot !== null)
}

export function canAddToCart(cart: readonly CartItem[]): boolean {
	return cart.length < MAX_BOOKING_ITEMS
}

/**
 * What the create request sends, in the order the client added them. FRM-2:
 * `forms` holds the checked answers of each Service that has a questionnaire.
 */
export function checkoutItems(
	cart: readonly CartItem[],
	forms?: ReadonlyMap<number, BookingItemFormInput>
): CreateBookingItemInput[] {
	return cart.flatMap(item => {
		if (!item.slot) return []
		const form = forms?.get(item.serviceId)
		return [form ? { scheduleSlotId: item.slot.id, form } : { scheduleSlotId: item.slot.id }]
	})
}
