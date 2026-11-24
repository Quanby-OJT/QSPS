import { describe, expect, it } from "vitest"

import { APPLICANT_TYPE_QUESTION, hasApplicantTypeAnswer, printoutsFor } from "./printouts"

describe("hasApplicantTypeAnswer", () => {
	it("is true when the client answered Local or Foreign", () => {
		expect(hasApplicantTypeAnswer({ "Applicant type": "Local" })).toBe(true)
		expect(hasApplicantTypeAnswer({ [APPLICANT_TYPE_QUESTION]: "Foreign" })).toBe(true)
	})

	it("ignores case and spaces in the question", () => {
		expect(hasApplicantTypeAnswer({ "  APPLICANT type ": "Local" })).toBe(true)
	})

	it("is false when the question is missing or unanswered", () => {
		expect(hasApplicantTypeAnswer({})).toBe(false)
		expect(hasApplicantTypeAnswer({ "Purpose of examination": "Work" })).toBe(false)
		expect(hasApplicantTypeAnswer({ "Applicant type": "Not answered" })).toBe(false)
		expect(hasApplicantTypeAnswer({ "Applicant type": "" })).toBe(false)
		expect(hasApplicantTypeAnswer({ "Applicant type": null })).toBe(false)
	})
})

describe("printoutsFor", () => {
	const answers = { "Applicant type": "Local" }

	it("shows both buttons for a Physical Examination booking awaiting payment", () => {
		expect(
			printoutsFor({ booking: { status: "pending_payment" }, formAnswers: answers }, true)
		).toEqual({ showApplicationForm: true, showRequestForPayment: true })
	})

	it("drops the Request for Payment once the booking is paid", () => {
		expect(printoutsFor({ booking: { status: "paid" }, formAnswers: answers }, true)).toEqual({
			showApplicationForm: true,
			showRequestForPayment: false,
		})
	})

	it("shows nothing without the print permission", () => {
		expect(
			printoutsFor({ booking: { status: "pending_payment" }, formAnswers: answers }, false)
		).toEqual({ showApplicationForm: false, showRequestForPayment: false })
	})

	it("shows nothing for a Service with no Applicant type question", () => {
		expect(printoutsFor({ booking: { status: "pending_payment" }, formAnswers: {} }, true)).toEqual(
			{
				showApplicationForm: false,
				showRequestForPayment: false,
			}
		)
	})
})
