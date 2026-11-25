import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

import type { LayoutField } from "./document-layout"
import type { IssueContext } from "./document-type"
import { answerOf, requiredAnswer } from "./questionnaire-answers"

/**
 * The questions of the biological substance questionnaires that the Biological
 * Substance Certification and the Biological Substance Permit are built from
 * (CRT-7). Both Services ask the same questions. Keep this wording in step with
 * the seed migration; an admin who renames a question must rename it here too,
 * or the document cannot be issued.
 */
export const BIOLOGICAL_QUESTIONS = {
	substance: "Substance or specimen",
	quantity: "Quantity",
	origin: "Origin",
	destination: "Destination",
	sender: "Sender or shipper",
	consignee: "Consignee",
	purpose: "Purpose",
} as const

/** What the two biological documents share (CRT-7). */
export interface BiologicalBasePayload {
	/** The client who applied. Stored under `holder.name`, so public verification masks it. */
	holder: { name: string }
	substance: string
	quantity: string
	origin: string
	destination: string
	sender: string | null
	consignee: string | null
	purpose: string | null
	serviceName: string
	dateIssued: string
	issuingStation: string
}

export function buildBiologicalBase(
	context: IssueContext,
	documentName: string
): BiologicalBasePayload {
	const question = BIOLOGICAL_QUESTIONS
	const answer = (label: string) => requiredAnswer(context.answers, label, documentName)
	return {
		holder: { name: context.holder.name },
		substance: answer(question.substance),
		quantity: answer(question.quantity),
		origin: answer(question.origin),
		destination: answer(question.destination),
		sender: answerOf(context.answers, question.sender),
		consignee: answerOf(context.answers, question.consignee),
		purpose: answerOf(context.answers, question.purpose),
		serviceName: context.serviceName,
		dateIssued: manilaDateOf(context.issuedAt),
		issuingStation: context.locationName,
	}
}

/** The SUBSTANCE block of both documents, in reading order. */
export function substanceFields(payload: BiologicalBasePayload): LayoutField[] {
	return [
		{ label: "Substance", value: payload.substance },
		{ label: "Quantity", value: payload.quantity },
		{ label: "Origin", value: payload.origin },
		{ label: "Destination", value: payload.destination },
		{ label: "Sender/shipper", value: payload.sender ?? "-" },
		{ label: "Consignee", value: payload.consignee ?? "-" },
		{ label: "Purpose", value: payload.purpose ?? "-" },
	]
}
