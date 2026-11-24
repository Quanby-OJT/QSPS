/**
 * The questionnaire question that says whether a Physical Examination
 * applicant is Local or Foreign (CRT-4). Same wording as
 * `APPLICANT_TYPE_QUESTION` in the backend and as the seeded questionnaire:
 * the web cannot import the backend, so the three are kept equal by their tests.
 */
export const APPLICANT_TYPE_QUESTION = "Applicant type"

/**
 * Whether the client answered the Applicant type question. The processing item
 * does not carry its Service Category, and the API prints the application
 * form only for an item with this answer, so the button shows in exactly the
 * cases where the print can succeed. `formAnswers` is question label to the
 * answer as staff read it; an unanswered question reads "Not answered".
 */
export function hasApplicantTypeAnswer(formAnswers: Readonly<Record<string, unknown>>): boolean {
	const wanted = APPLICANT_TYPE_QUESTION.toLowerCase()
	return Object.entries(formAnswers).some(([question, answer]) => {
		if (question.trim().toLowerCase() !== wanted) return false
		return typeof answer === "string" && answer.trim() !== "" && answer !== "Not answered"
	})
}

export interface PrintoutVisibility {
	showApplicationForm: boolean
	showRequestForPayment: boolean
}

/**
 * Which printouts staff see for one processing item. Both need the print
 * permission. The Request for Payment is only for a Booking still awaiting
 * payment, so it disappears once the client has paid.
 */
export function printoutsFor(
	item: { booking: { status: string }; formAnswers: Readonly<Record<string, unknown>> },
	canPrint: boolean
): PrintoutVisibility {
	const isPhysicalExam = canPrint && hasApplicantTypeAnswer(item.formAnswers)
	return {
		showApplicationForm: isPhysicalExam,
		showRequestForPayment: isPhysicalExam && item.booking.status === "pending_payment",
	}
}
