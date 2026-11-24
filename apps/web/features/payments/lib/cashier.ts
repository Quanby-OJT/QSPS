import type { CashierBooking, TenderType } from "@repo/contracts"

import { parseFeeCentavos } from "@/features/services/lib/fee"

export const TENDER_LABELS: Record<TenderType, string> = {
	cash: "Cash",
	card: "Card",
	check: "Check",
}

const STATUS_LABELS: Record<CashierBooking["status"], string> = {
	pending_approval: "Awaiting approval",
	pending_payment: "Awaiting payment",
	paid: "Paid",
	completed: "Completed",
	cancelled: "Cancelled",
	rejected: "Rejected",
	forfeited: "Forfeited",
	refund_requested: "Refund requested",
	refunded: "Refunded",
}

export function bookingStatusLabel(status: CashierBooking["status"]): string {
	return STATUS_LABELS[status]
}

/** Only a booking awaiting payment can be collected; anything else shows its status. */
export function canCollect(booking: Pick<CashierBooking, "status">): boolean {
	return booking.status === "pending_payment"
}

export type AmountCheck =
	| { ok: true; receivedCentavos: number; changeCentavos: number }
	| { ok: false; message: string }

/**
 * What the cashier typed as received, checked against the amount due: cash
 * may be more (the change is shown), card and check must match exactly.
 * The API applies the same rules.
 */
export function checkAmountReceived(
	typed: string,
	dueCentavos: number,
	tenderType: TenderType
): AmountCheck {
	const receivedCentavos = parseFeeCentavos(typed)
	if (receivedCentavos === null) {
		return { ok: false, message: "Enter the amount received in pesos, e.g. 1500 or 1500.00" }
	}
	if (receivedCentavos < dueCentavos) {
		return { ok: false, message: "The amount received is less than the amount due" }
	}
	if (tenderType !== "cash" && receivedCentavos !== dueCentavos) {
		return { ok: false, message: "A card or check payment must be for the exact amount due" }
	}
	return { ok: true, receivedCentavos, changeCentavos: receivedCentavos - dueCentavos }
}
