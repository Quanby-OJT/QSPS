/** What `readableAnswers` returns for a question the client left blank. */
const NOT_ANSWERED = "Not answered"

/**
 * A question the document needs was not answered (CRT-5). Plain `Error` on
 * purpose: backend Jest cannot load `@orpc/server`, so the document-type files
 * stay free of it, and `DocumentService` turns this into a 409 that names the
 * question.
 */
export class MissingAnswerError extends Error {
	constructor(
		readonly question: string,
		readonly documentName: string
	) {
		super(
			`The questionnaire has no answer for "${question}", so the ${documentName} cannot be issued yet.`
		)
		this.name = "MissingAnswerError"
	}
}

/**
 * One answer from the client's questionnaire (CRT-5), keyed by the question's
 * label as `readableAnswers` returns it. Null when the question is missing
 * from the questionnaire or was left blank.
 */
export function answerOf(
	answers: Record<string, string> | undefined,
	question: string
): string | null {
	const value = answers?.[question]?.trim()
	return value && value !== NOT_ANSWERED ? value : null
}

/** An answer the document cannot be issued without: refuses with an error that names the question. */
export function requiredAnswer(
	answers: Record<string, string> | undefined,
	question: string,
	documentName: string
): string {
	const value = answerOf(answers, question)
	if (value === null) throw new MissingAnswerError(question, documentName)
	return value
}
