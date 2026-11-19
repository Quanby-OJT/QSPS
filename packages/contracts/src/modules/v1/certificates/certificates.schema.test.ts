import { describe, expect, it } from "vitest"

import {
	DocumentTokenParamSchema,
	DocumentVerificationSchema,
	IcvIssueDetailsSchema,
	ManualVerificationSchema,
} from "./certificates.schema.js"

const TOKEN = "AbCdEfGhIjKlMnOpQrSt_-"

describe("certificate schemas", () => {
	describe("ICV issue details (CRT-1)", () => {
		const details = {
			batchNumber: " YF-24A ",
			vaccinatorName: "Dr. Juan Reyes",
			validFrom: "2026-11-19",
		}

		it("trims the text and turns a blank passport/ID into null", () => {
			expect(
				IcvIssueDetailsSchema.parse({ ...details, validUntil: null, passportOrIdNumber: "  " })
			).toMatchObject({ batchNumber: "YF-24A", validUntil: null, passportOrIdNumber: null })
		})

		it("refuses a valid-until before valid-from", () => {
			expect(
				IcvIssueDetailsSchema.safeParse({ ...details, validUntil: "2026-11-18" }).success
			).toBe(false)
		})
	})

	describe("verification token (CRT-2)", () => {
		it("accepts a 22-character base64url token", () => {
			expect(DocumentTokenParamSchema.parse({ token: TOKEN }).token).toBe(TOKEN)
		})

		it.each(["", "short", `${TOKEN}x`, "AbCdEfGhIjKlMnOpQrSt+/"])("refuses %j", token => {
			expect(DocumentTokenParamSchema.safeParse({ token }).success).toBe(false)
		})
	})

	describe("manual verification (CRT-2)", () => {
		it("uppercases the document number and keeps the code's case", () => {
			expect(
				ManualVerificationSchema.parse({
					documentNumber: " icv-mnl-2026-000001 ",
					code: "qRsT_-Ab",
				})
			).toEqual({ documentNumber: "ICV-MNL-2026-000001", code: "qRsT_-Ab" })
		})

		it("needs the code as well as the number", () => {
			expect(
				ManualVerificationSchema.safeParse({ documentNumber: "ICV-MNL-2026-000001", code: "" })
					.success
			).toBe(false)
			expect(
				ManualVerificationSchema.safeParse({ documentNumber: "ICV-MNL-2026-000001", code: "abc" })
					.success
			).toBe(false)
		})
	})

	describe("verification response (CRT-2)", () => {
		const response = {
			documentType: "icv-record",
			documentTitle: "International Certificate of Vaccination record",
			documentNumber: "ICV-MNL-2026-000001",
			holderName: "J*** D** C***",
			issuingLocation: "Manila",
			issuedAt: "2026-11-19T02:00:00.000Z",
			status: "valid",
			statusChangedAt: null,
		}

		it("turns the issue date back into a Date", () => {
			expect(DocumentVerificationSchema.parse(response).issuedAt).toBeInstanceOf(Date)
		})

		it("drops anything else the server might send, such as payload fields", () => {
			const parsed = DocumentVerificationSchema.parse({
				...response,
				passportOrIdNumber: "P1234567",
			})
			expect(parsed).not.toHaveProperty("passportOrIdNumber")
		})
	})
})
