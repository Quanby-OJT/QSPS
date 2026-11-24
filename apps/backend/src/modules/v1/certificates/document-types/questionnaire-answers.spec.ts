import { answerOf, MissingAnswerError, requiredAnswer } from "./questionnaire-answers"

describe("questionnaire answers (CRT-5)", () => {
	it("returns the answer, trimmed", () => {
		expect(answerOf({ "Vessel name": "  MV Pioneer " }, "Vessel name")).toBe("MV Pioneer")
	})

	it("returns null for a missing question, a blank answer, or 'Not answered'", () => {
		expect(answerOf(undefined, "Vessel name")).toBeNull()
		expect(answerOf({}, "Vessel name")).toBeNull()
		expect(answerOf({ "Vessel name": "   " }, "Vessel name")).toBeNull()
		expect(answerOf({ "Vessel name": "Not answered" }, "Vessel name")).toBeNull()
	})

	it("refuses with an error that names the question and the document", () => {
		let caught: unknown
		try {
			requiredAnswer(
				{ "Vessel name": "Not answered" },
				"Vessel name",
				"Ship Sanitation Certificate"
			)
		} catch (error) {
			caught = error
		}
		expect(caught).toBeInstanceOf(MissingAnswerError)
		const error = caught as MissingAnswerError
		expect(error.question).toBe("Vessel name")
		expect(error.message).toContain("Vessel name")
		expect(error.message).toContain("Ship Sanitation Certificate")
	})

	it("returns a required answer that is there", () => {
		expect(requiredAnswer({ "Vessel name": "MV Pioneer" }, "Vessel name", "Certificate")).toBe(
			"MV Pioneer"
		)
	})
})
