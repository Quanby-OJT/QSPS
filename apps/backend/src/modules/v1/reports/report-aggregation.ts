import { inScope, type ResolvedScope } from "@/common/scope/scope-match"

/**
 * One booking item belonging to one payment in the selected period.
 * The database query must supply every item of each payment's booking,
 * including items outside the caller's Scope, so the payment can be
 * apportioned before Scope is applied.
 */
export type ReportItemRow = {
	paymentId: number
	bookingId: number
	itemId: number
	amountCentavos: number
	feeCentavos: number
	locationId: number
	locationName: string
	serviceCategoryId: number
	serviceCategoryName: string
}

type Bucket = {
	bookingIds: Set<number>
	collectionsCentavos: number
}

function newBucket(): Bucket {
	return { bookingIds: new Set<number>(), collectionsCentavos: 0 }
}

/**
 * Split a payment across its booking items in proportion to their service
 * fees. Largest-remainder rounding preserves the exact payment amount.
 * When every fee is zero, the amount is split equally.
 */
function allocatePayment(rows: ReportItemRow[]): Map<number, number> {
	const first = rows[0]
	if (!first) return new Map()

	const amount = first.amountCentavos
	if (!Number.isSafeInteger(amount) || amount < 0) {
		throw new Error("Invalid payment amount")
	}

	const sorted = [...rows].sort((a, b) => a.itemId - b.itemId)

	for (const row of sorted) {
		if (
			row.paymentId !== first.paymentId ||
			row.bookingId !== first.bookingId ||
			row.amountCentavos !== amount ||
			!Number.isSafeInteger(row.feeCentavos) ||
			row.feeCentavos < 0
		) {
			throw new Error("Invalid payment report rows")
		}
	}

	const feeTotal = sorted.reduce((sum, row) => sum + BigInt(row.feeCentavos), 0n)
	const denominator = feeTotal === 0n ? BigInt(sorted.length) : feeTotal
	const paymentAmount = BigInt(amount)

	const shares = sorted.map(row => {
		const weight = feeTotal === 0n ? 1n : BigInt(row.feeCentavos)
		const numerator = paymentAmount * weight
		return {
			itemId: row.itemId,
			whole: numerator / denominator,
			remainder: numerator % denominator,
		}
	})

	const assigned = shares.reduce((sum, share) => sum + share.whole, 0n)
	const remaining = Number(paymentAmount - assigned)

	shares.sort((a, b) => {
		if (a.remainder === b.remainder) return a.itemId - b.itemId
		return a.remainder > b.remainder ? -1 : 1
	})

	for (let index = 0; index < remaining; index++) {
		const share = shares[index]
		if (!share) throw new Error("Payment allocation failed")
		share.whole += 1n
	}

	return new Map(shares.map(share => [share.itemId, Number(share.whole)]))
}

/**
 * Counts each booking once in each applicable bucket. A booking with items
 * in multiple locations or categories can appear in more than one row, but
 * is counted only once in the consolidated total.
 */
export function aggregateReport(rows: ReportItemRow[], scope: ResolvedScope) {
	const payments = new Map<number, ReportItemRow[]>()

	for (const row of rows) {
		const existing = payments.get(row.paymentId)
		if (existing) existing.push(row)
		else payments.set(row.paymentId, [row])
	}

	const total = newBucket()
	const locations = new Map<number, Bucket & { locationId: number; locationName: string }>()
	const categories = new Map<
		number,
		Bucket & { serviceCategoryId: number; serviceCategoryName: string }
	>()

	for (const paymentRows of payments.values()) {
		const shares = allocatePayment(paymentRows)

		for (const row of paymentRows) {
			if (
				!inScope(scope, {
					locationId: row.locationId,
					serviceCategoryId: row.serviceCategoryId,
				})
			) {
				continue
			}

			const amount = shares.get(row.itemId)
			if (amount === undefined) throw new Error("Missing payment allocation")

			total.bookingIds.add(row.bookingId)
			total.collectionsCentavos += amount

			let location = locations.get(row.locationId)
			if (!location) {
				location = {
					...newBucket(),
					locationId: row.locationId,
					locationName: row.locationName,
				}
				locations.set(row.locationId, location)
			}
			location.bookingIds.add(row.bookingId)
			location.collectionsCentavos += amount

			let category = categories.get(row.serviceCategoryId)
			if (!category) {
				category = {
					...newBucket(),
					serviceCategoryId: row.serviceCategoryId,
					serviceCategoryName: row.serviceCategoryName,
				}
				categories.set(row.serviceCategoryId, category)
			}
			category.bookingIds.add(row.bookingId)
			category.collectionsCentavos += amount
		}
	}

	return {
		total: {
			applicants: total.bookingIds.size,
			collectionsCentavos: total.collectionsCentavos,
		},
		locations: [...locations.values()]
			.map(location => ({
				locationId: location.locationId,
				locationName: location.locationName,
				applicants: location.bookingIds.size,
				collectionsCentavos: location.collectionsCentavos,
			}))
			.sort((a, b) => a.locationName.localeCompare(b.locationName)),
		serviceCategories: [...categories.values()]
			.map(category => ({
				serviceCategoryId: category.serviceCategoryId,
				serviceCategoryName: category.serviceCategoryName,
				applicants: category.bookingIds.size,
				collectionsCentavos: category.collectionsCentavos,
			}))
			.sort((a, b) => a.serviceCategoryName.localeCompare(b.serviceCategoryName)),
	}
}