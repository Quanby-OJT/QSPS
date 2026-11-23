import { describe, expect, it } from "vitest"

import {
	CreatePaymentSchema,
	PaymentCodeSchema,
	PaymentIdParamSchema,
	PaymentStatusResponseSchema,
	ReceiptTokenSchema,
	ReceiptVerificationSchema,
	UpdatePaymentChannelSchema,
} from "./payments.schema.js"

describe("payment schemas", () => {
	it("accepts a booking id and a channel code", () => {
		expect(CreatePaymentSchema.parse({ bookingId: 31, channelCode: "fake" })).toEqual({
			bookingId: 31,
			channelCode: "fake",
		})
		expect(CreatePaymentSchema.safeParse({ bookingId: 0, channelCode: "fake" }).success).toBe(false)
		expect(CreatePaymentSchema.safeParse({ bookingId: 31 }).success).toBe(false)
	})

	it("accepts lowercase codes only", () => {
		expect(PaymentCodeSchema.safeParse("linkbiz").success).toBe(true)
		expect(PaymentCodeSchema.safeParse("gcash-direct").success).toBe(true)
		expect(PaymentCodeSchema.safeParse("GCash").success).toBe(false)
		expect(PaymentCodeSchema.safeParse("../fake").success).toBe(false)
	})

	it("reads the payment id from the path as a number", () => {
		expect(PaymentIdParamSchema.parse({ paymentId: "12" })).toEqual({ paymentId: 12 })
		expect(PaymentIdParamSchema.safeParse({ paymentId: "abc" }).success).toBe(false)
	})

	it("rejects an unknown payment status", () => {
		const base = {
			paymentId: 1,
			bookingId: 31,
			referenceNumber: "QSPS-261117-AB12CD",
			status: "pending",
			bookingStatus: "pending_payment",
			amountCentavos: 150000,
			receiptNumber: null,
		}
		expect(PaymentStatusResponseSchema.safeParse(base).success).toBe(true)
		expect(PaymentStatusResponseSchema.safeParse({ ...base, status: "paid" }).success).toBe(false)
	})

	it("accepts only 22-character base64url receipt tokens", () => {
		expect(ReceiptTokenSchema.safeParse("AbCdEfGhIjKlMnOpQrSt_-").success).toBe(true)
		expect(ReceiptTokenSchema.safeParse("too-short").success).toBe(false)
		expect(ReceiptTokenSchema.safeParse("AbCdEfGhIjKlMnOpQrSt/=").success).toBe(false)
	})

	it("turns the issue date of a verified receipt back into a date", () => {
		const verified = ReceiptVerificationSchema.parse({
			receiptNumber: "QSPS-R-261118-000001",
			amountCentavos: 150000,
			issuedAt: "2026-11-18T01:00:00.000Z",
			status: "valid",
		})
		expect(verified.issuedAt).toEqual(new Date("2026-11-18T01:00:00.000Z"))
	})

	describe("payment channel settings", () => {
		const gcash = {
			code: "gcash",
			name: "GCash",
			providerCode: "fake",
			convenienceFeeCentavos: 1500,
			convenienceFeeBps: 250,
			isEnabled: true,
		}

		it("accepts a fixed fee, a percentage, or both", () => {
			expect(UpdatePaymentChannelSchema.safeParse(gcash).success).toBe(true)
			expect(
				UpdatePaymentChannelSchema.safeParse({ ...gcash, convenienceFeeBps: 0 }).success
			).toBe(true)
			expect(
				UpdatePaymentChannelSchema.safeParse({ ...gcash, convenienceFeeCentavos: 0 }).success
			).toBe(true)
		})

		it("refuses to enable a channel with no provider", () => {
			const result = UpdatePaymentChannelSchema.safeParse({ ...gcash, providerCode: null })
			expect(result.success).toBe(false)
			expect(
				UpdatePaymentChannelSchema.safeParse({ ...gcash, providerCode: null, isEnabled: false })
					.success
			).toBe(true)
		})

		it("keeps fees in range", () => {
			expect(
				UpdatePaymentChannelSchema.safeParse({ ...gcash, convenienceFeeBps: 10_001 }).success
			).toBe(false)
			expect(
				UpdatePaymentChannelSchema.safeParse({ ...gcash, convenienceFeeCentavos: -1 }).success
			).toBe(false)
			expect(UpdatePaymentChannelSchema.safeParse({ ...gcash, name: "  " }).success).toBe(false)
		})
	})
})
