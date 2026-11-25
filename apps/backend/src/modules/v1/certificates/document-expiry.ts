import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

/**
 * Whether a document has expired (CRT-5). `validUntil` is the last valid day
 * (YYYY-MM-DD), so the document is still valid all through that day in Manila
 * and expired from the next day on. A null `validUntil` never expires.
 *
 * Both sides are Manila calendar dates in the same YYYY-MM-DD form, so a plain
 * string comparison is a date comparison. Expiry is worked out on every lookup
 * and never stored, so there is nothing to keep in step with the clock.
 */
export function hasExpired(validUntil: string | null, now: Date): boolean {
	return validUntil !== null && manilaDateOf(now) > validUntil
}
