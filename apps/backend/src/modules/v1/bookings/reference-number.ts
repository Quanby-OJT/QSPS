import { randomInt } from "node:crypto"

import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

/**
 * Letters and digits for the random part. I, O, 0 and 1 are left out because
 * they are easy to misread when a client reads the number aloud or types it.
 */
export const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

const SUFFIX_LENGTH = 6

/**
 * A Booking Reference Number: `QSPS-YYMMDD-XXXXXX`.
 *
 * YYMMDD is the booking date in Asia/Manila. The suffix is random, so the
 * caller must check the result is unused before saving it (`BookingService`
 * does, and the column is unique as a backstop).
 *
 * @param pick returns a random whole number from 0 up to, not including, `max`
 */
export function generateReferenceNumber(
	now: Date,
	pick: (max: number) => number = randomInt
): string {
	const date = manilaDateOf(now)
	const yymmdd = `${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}`
	let suffix = ""
	for (let index = 0; index < SUFFIX_LENGTH; index++) {
		suffix += REFERENCE_ALPHABET.charAt(pick(REFERENCE_ALPHABET.length))
	}
	return `QSPS-${yymmdd}-${suffix}`
}
