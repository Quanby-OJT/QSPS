import { randomBytes } from "node:crypto"

import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

/**
 * An e-Receipt number: `QSPS-R-YYMMDD-NNNNNN`.
 *
 * YYMMDD is the issue date in Asia/Manila; NNNNNN is the Payment id. A
 * Payment has at most one Receipt, so the number is unique without a
 * separate counter (the column is unique as a backstop). This is the
 * e-Receipt number, not BOQ's Official Receipt series (out of scope, PAY-2).
 */
export function receiptNumberFor(paymentId: number, issuedAt: Date): string {
	const date = manilaDateOf(issuedAt)
	const yymmdd = `${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}`
	return `QSPS-R-${yymmdd}-${String(paymentId).padStart(6, "0")}`
}

/** 128 random bits, URL-safe (base64url, 22 characters). Never guessable. */
export function newVerificationToken(): string {
	return randomBytes(16).toString("base64url")
}
