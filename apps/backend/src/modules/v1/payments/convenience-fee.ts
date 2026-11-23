/** How a channel charges its convenience fee (PAY-5). */
export interface ConvenienceFeeRule {
	/** Fixed part, in centavos. */
	convenienceFeeCentavos: number
	/** Percentage part, in basis points of the Service fees: 250 = 2.5%. */
	convenienceFeeBps: number
}

export interface ChargeBreakdown {
	/** Service fees: the Booking total. */
	subtotalCentavos: number
	convenienceFeeCentavos: number
	/** What the client pays: Service fees plus the convenience fee. */
	totalCentavos: number
}

/**
 * The one place the convenience fee is worked out (PAY-5). Checkout shows
 * this, `PaymentService.create` charges and stores it, and the Receipt prints
 * the stored figures, so all three always agree.
 *
 * Fee = fixed part + percentage of the Service fees, rounded to the nearest
 * centavo (half a centavo rounds up). Integer arithmetic only.
 */
export function chargeFor(subtotalCentavos: number, rule: ConvenienceFeeRule): ChargeBreakdown {
	// Adding half the divisor before dividing rounds half up, in whole numbers.
	const percentagePart = Math.floor((subtotalCentavos * rule.convenienceFeeBps + 5_000) / 10_000)
	const convenienceFeeCentavos = rule.convenienceFeeCentavos + percentagePart
	return {
		subtotalCentavos,
		convenienceFeeCentavos,
		totalCentavos: subtotalCentavos + convenienceFeeCentavos,
	}
}
