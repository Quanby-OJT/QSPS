import { describe, expect, it } from "vitest"

import {
	ApprovalQueueRequestSchema,
	BookingItemIdParamSchema,
	CheckInSchema,
	DecideApprovalSchema,
	MAX_CORRECTIONS,
	MIN_OVERRIDE_REASON_LENGTH,
	OverrideItemSchema,
	ProcessingQueueRequestSchema,
	RecordAssessmentSchema,
} from "./processing.schema.js"

describe("CheckInSchema", () => {
	it("accepts a scanned or typed Reference Number, trimming and upper-casing it", () => {
		expect(CheckInSchema.parse({ referenceNumber: "  qsps-261117-ab12cd\n" })).toEqual({
			referenceNumber: "QSPS-261117-AB12CD",
		})
	})

	it("rejects anything that is not a Reference Number", () => {
		expect(CheckInSchema.safeParse({ referenceNumber: "12345" }).success).toBe(false)
		expect(CheckInSchema.safeParse({ referenceNumber: "" }).success).toBe(false)
	})
})

describe("ProcessingQueueRequestSchema", () => {
	it("defaults to today when no date is sent", () => {
		expect(ProcessingQueueRequestSchema.parse({})).toEqual({})
	})

	it("accepts a Manila business date and rejects other formats", () => {
		expect(ProcessingQueueRequestSchema.parse({ date: "2026-11-18" })).toEqual({
			date: "2026-11-18",
		})
		expect(ProcessingQueueRequestSchema.safeParse({ date: "11/18/2026" }).success).toBe(false)
	})
})

describe("BookingItemIdParamSchema", () => {
	it("reads the id from the path as a number", () => {
		expect(BookingItemIdParamSchema.parse({ bookingItemId: "44" })).toEqual({ bookingItemId: 44 })
	})
})

describe("RecordAssessmentSchema", () => {
	it("clears without a note and fills in empty defaults", () => {
		expect(RecordAssessmentSchema.parse({ bookingItemId: 44, outcome: "cleared" })).toEqual({
			bookingItemId: 44,
			outcome: "cleared",
			notes: "",
			corrections: {},
		})
	})

	it.each(["returned", "rejected"])("needs a note to mark an item %s", outcome => {
		const result = RecordAssessmentSchema.safeParse({ bookingItemId: 44, outcome, notes: "  " })
		expect(result.success).toBe(false)
	})

	it("keeps the corrections staff recorded", () => {
		expect(
			RecordAssessmentSchema.parse({
				bookingItemId: 44,
				outcome: "returned",
				notes: "Birth date does not match the passport",
				corrections: { birthDate: "1990-02-01" },
			}).corrections
		).toEqual({ birthDate: "1990-02-01" })
	})

	it("rejects an unknown outcome and too many corrections", () => {
		expect(
			RecordAssessmentSchema.safeParse({ bookingItemId: 44, outcome: "approved" }).success
		).toBe(false)
		const corrections = Object.fromEntries(
			Array.from({ length: MAX_CORRECTIONS + 1 }, (_, index) => [`field${index}`, "x"])
		)
		expect(
			RecordAssessmentSchema.safeParse({ bookingItemId: 44, outcome: "cleared", corrections })
				.success
		).toBe(false)
	})
})

describe("ApprovalQueueRequestSchema (PRC-3)", () => {
	it("shows the pending items by default", () => {
		expect(ApprovalQueueRequestSchema.parse({})).toEqual({ view: "pending" })
	})

	it("accepts the rejected view and refuses others", () => {
		expect(ApprovalQueueRequestSchema.parse({ view: "rejected" })).toEqual({ view: "rejected" })
		expect(ApprovalQueueRequestSchema.safeParse({ view: "cleared" }).success).toBe(false)
	})
})

describe("DecideApprovalSchema (PRC-3)", () => {
	it("approves without a note", () => {
		expect(DecideApprovalSchema.parse({ bookingItemId: "44", decision: "approve" })).toEqual({
			bookingItemId: 44,
			decision: "approve",
			notes: "",
		})
	})

	it("needs a note to send an item back", () => {
		expect(
			DecideApprovalSchema.safeParse({ bookingItemId: 44, decision: "return", notes: "  " }).success
		).toBe(false)
		expect(
			DecideApprovalSchema.parse({
				bookingItemId: 44,
				decision: "return",
				notes: "Check the batch number",
			}).notes
		).toBe("Check the batch number")
	})

	it("refuses an unknown decision", () => {
		expect(DecideApprovalSchema.safeParse({ bookingItemId: 44, decision: "reject" }).success).toBe(
			false
		)
	})
})

describe("OverrideItemSchema (PRC-3)", () => {
	it("needs a real reason", () => {
		expect(OverrideItemSchema.safeParse({ bookingItemId: 44 }).success).toBe(false)
		expect(OverrideItemSchema.safeParse({ bookingItemId: 44, reason: "ok" }).success).toBe(false)
		expect(
			OverrideItemSchema.safeParse({
				bookingItemId: 44,
				reason: "x".repeat(MIN_OVERRIDE_REASON_LENGTH - 1),
			}).success
		).toBe(false)
	})

	it("keeps a trimmed reason", () => {
		expect(
			OverrideItemSchema.parse({ bookingItemId: 44, reason: "  Exemption letter verified  " })
		).toEqual({ bookingItemId: 44, reason: "Exemption letter verified" })
	})
})
