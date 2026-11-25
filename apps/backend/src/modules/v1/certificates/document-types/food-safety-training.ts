import type { PdfDocument } from "@/common/pdf/pdf.service"
import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

import { formatCalendarDate } from "./calendar-date"
import { drawDocumentLayout } from "./document-layout"
import type { DocumentTypeDefinition, IssueContext, PdfExtras } from "./document-type"
import { answerOf } from "./questionnaire-answers"

/**
 * The questions of the seminar questionnaire that the Food Safety Training
 * Certificate prints when the client answered them (CRT-6). Both are optional.
 * Keep this wording in step with the seed migration that creates the
 * questionnaire.
 */
export const FOOD_SAFETY_TRAINING_QUESTIONS = {
	employer: "Establishment or employer",
	position: "Position or role",
} as const

const DOCUMENT_NAME = "Food Safety Training Certificate"

/** The time of day in Manila, 24-hour, e.g. "08:00". */
export function manilaTimeOf(date: Date): string {
	return new Intl.DateTimeFormat("en-GB", {
		timeZone: "Asia/Manila",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(date)
}

/**
 * Food Safety Training Certificate (CRT-6, document type
 * `food-safety-training`, TOR §VIII.3): proof that the holder attended a Basic
 * Hygiene and Sanitation seminar session. Officers type nothing: everything
 * comes from the booking, the session's Schedule Slot and the client's
 * questionnaire answers. It does not expire. Wording and numbering are
 * assumptions until BOQ signs them off (PRD open item 6).
 */
export interface FoodSafetyTrainingPayload {
	/** The participant, under `holder.name` like every document type. */
	holder: { name: string }
	employer: string | null
	position: string | null
	/** The seminar (the Service's name). */
	serviceName: string
	/** The session's date in Manila, YYYY-MM-DD, and its start and end as HH:mm. */
	sessionDate: string
	sessionStart: string
	sessionEnd: string
	venue: string
	dateIssued: string
	issuingStation: string
}

export function buildFoodSafetyTrainingPayload(context: IssueContext): FoodSafetyTrainingPayload {
	const session = context.session
	if (!session) {
		// DocumentService always sets it; reaching this is a programming error.
		throw new Error("A Food Safety Training Certificate needs the seminar session")
	}
	const question = FOOD_SAFETY_TRAINING_QUESTIONS
	return {
		holder: { name: context.holder.name },
		employer: answerOf(context.answers, question.employer),
		position: answerOf(context.answers, question.position),
		serviceName: context.serviceName,
		sessionDate: manilaDateOf(session.startsAt),
		sessionStart: manilaTimeOf(session.startsAt),
		sessionEnd: manilaTimeOf(session.endsAt),
		venue: context.locationName,
		dateIssued: manilaDateOf(context.issuedAt),
		issuingStation: context.locationName,
	}
}

export function drawFoodSafetyTraining(
	doc: PdfDocument,
	payload: FoodSafetyTrainingPayload,
	extras: PdfExtras
): void {
	drawDocumentLayout(
		doc,
		{
			title: DOCUMENT_NAME,
			subtitle: "Food Safety - Bureau of Quarantine, Republic of the Philippines",
			sections: [
				{
					heading: "PARTICIPANT",
					fields: [
						{ label: "Name", value: payload.holder.name },
						{ label: "Establishment", value: payload.employer ?? "-" },
						{ label: "Position", value: payload.position ?? "-" },
					],
				},
				{
					heading: "SEMINAR",
					fields: [
						{ label: "Seminar", value: payload.serviceName },
						{ label: "Date", value: formatCalendarDate(payload.sessionDate) },
						{ label: "Time", value: `${payload.sessionStart} - ${payload.sessionEnd}` },
						{ label: "Venue", value: payload.venue },
						{ label: "Date issued", value: formatCalendarDate(payload.dateIssued) },
						{ label: "Issuing station", value: payload.issuingStation },
					],
				},
			],
			note: "This certifies that the participant attended the seminar named above.",
		},
		extras
	)
}

export const foodSafetyTraining: DocumentTypeDefinition<undefined> = {
	type: "food-safety-training",
	title: DOCUMENT_NAME,
	// Assumed prefix until BOQ signs off the numbering (PRD open item 6).
	numberPrefix: "FST",
	buildPayload: context => ({ ...buildFoodSafetyTrainingPayload(context) }),
	// A training certificate does not expire.
	validUntil: () => null,
	draw: (doc, payload, extras) =>
		drawFoodSafetyTraining(doc, payload as unknown as FoodSafetyTrainingPayload, extras),
}
