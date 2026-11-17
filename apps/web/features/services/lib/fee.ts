/** Largest value a Postgres integer column holds. */
const MAX_CENTAVOS = 2_147_483_647

/**
 * Turn what an admin types in pesos ("150", "150.5", "0.05") into integer
 * centavos. Returns null for anything that is not a non-negative amount with at
 * most two decimal places. Uses string arithmetic, never floating point, so
 * "0.29" is 29 centavos and not 28.999….
 */
export function parseFeeCentavos(value: string): number | null {
	const trimmed = value.trim()
	if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
	const [whole = "0", fraction = ""] = trimmed.split(".")
	const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
	return Number.isSafeInteger(amount) && amount <= MAX_CENTAVOS ? amount : null
}

/** Centavos to a pesos string with two decimals, e.g. 15050 → "150.50". */
export function feeInPesos(feeCentavos: number): string {
	return (feeCentavos / 100).toFixed(2)
}