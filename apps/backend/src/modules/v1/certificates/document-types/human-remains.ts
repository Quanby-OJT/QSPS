import type { HumanRemainsDetails } from "@repo/contracts"

import type { PdfDocument } from "@/common/pdf/pdf.service"
import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

import { formatCalendarDate } from "./calendar-date"
import { drawDocumentLayout } from "./document-layout"
import type { DocumentTypeDefinition, IssueContext, PdfExtras } from "./document-type"
import { answerOf, requiredAnswer } from "./questionnaire-answers"

/**
 * The questions of the human remains questionnaire that a Human Remains
 * Certificate is built from (CRT-7). Keep this wording in step with the seed
 * migration that creates the questionnaire; an admin who renames a question
 * must rename it here too, or the certificate cannot be issued.
 */
export const HUMAN_REMAINS_QUESTIONS = {
	deceasedName: "Name of the deceased",
	dateOfDeath: "Date of death",
	causeOfDeath: "Cause of death",
	preparation: "Embalmed or cremated",
	consigneeName: "Consignee name",
	consigneeAddress: "Consignee address",
	consigneeContact: "Consignee contact number",
	origin: "Origin",
	destination: "Destination",
	carrier: "Carrier, flight or vessel",
	transportDate: "Date of transport",
} as const

const DOCUMENT_NAME = "Human Remains Certificate"

/**
 * Human Remains Certificate (CRT-7, document type `human-remains`, TOR §VIII.3),
 * issued so that carriers and receiving authorities can verify the transport of
 * a deceased person. Everything printed comes from the client's questionnaire
 * answers, so staff type nothing. It holds a deceased person's name and cause of
 * death, so `DocumentService` stores it encrypted (`sensitive`). Wording and
 * numbering are assumptions until BOQ signs them off (PRD open item 6).
 */
export interface HumanRemainsPayload {
	/**
	 * The deceased. Stored under `holder.name` like every document type, so
	 * public verification shows it masked, as it does any person's name.
	 */
	holder: { name: string }
	deceased: {
		name: string
		/** As the client wrote it, because the questionnaire asks for text. */
		dateOfDeath: string
		causeOfDeath: string
		/** Embalmed, cremated or as the client described it. */
		preparation: string
	}
	consignee: { name: string; address: string; contactNumber: string | null }
	transport: {
		origin: string
		destination: string
		carrier: string
		/** As the client wrote it. */
		date: string
	}
	/** The client who applied. */
	requestedBy: string
	serviceName: string
	dateIssued: string
	issuingStation: string
}

export function buildHumanRemainsPayload(
	context: IssueContext,
	// Staff add nothing: the details come from the questionnaire.
	_details?: HumanRemainsDetails
): HumanRemainsPayload {
	const question = HUMAN_REMAINS_QUESTIONS
	const answer = (label: string) => requiredAnswer(context.answers, label, DOCUMENT_NAME)
	const name = answer(question.deceasedName)
	return {
		holder: { name },
		deceased: {
			name,
			dateOfDeath: answer(question.dateOfDeath),
			causeOfDeath: answer(question.causeOfDeath),
			preparation: answer(question.preparation),
		},
		consignee: {
			name: answer(question.consigneeName),
			address: answer(question.consigneeAddress),
			contactNumber: answerOf(context.answers, question.consigneeContact),
		},
		transport: {
			origin: answer(question.origin),
			destination: answer(question.destination),
			carrier: answer(question.carrier),
			date: answer(question.transportDate),
		},
		requestedBy: context.holder.name,
		serviceName: context.serviceName,
		dateIssued: manilaDateOf(context.issuedAt),
		issuingStation: context.locationName,
	}
}

export function drawHumanRemains(
	doc: PdfDocument,
	payload: HumanRemainsPayload,
	extras: PdfExtras
): void {
	drawDocumentLayout(
		doc,
		{
			title: DOCUMENT_NAME,
			subtitle: "Transport of human remains - Bureau of Quarantine, Republic of the Philippines",
			sections: [
				{
					heading: "DECEASED",
					fields: [
						{ label: "Name", value: payload.deceased.name },
						{ label: "Date of death", value: payload.deceased.dateOfDeath },
						{ label: "Cause of death", value: payload.deceased.causeOfDeath },
						{ label: "Embalmed/cremated", value: payload.deceased.preparation },
					],
				},
				{
					heading: "CONSIGNEE",
					fields: [
						{ label: "Name", value: payload.consignee.name },
						{ label: "Address", value: payload.consignee.address },
						{ label: "Contact No.", value: payload.consignee.contactNumber ?? "-" },
					],
				},
				{
					heading: "TRANSPORT",
					fields: [
						{ label: "Carrier", value: payload.transport.carrier },
						{ label: "Origin", value: payload.transport.origin },
						{ label: "Destination", value: payload.transport.destination },
						{ label: "Date of transport", value: payload.transport.date },
					],
				},
				{
					heading: "CERTIFICATION",
					fields: [
						{ label: "Requested by", value: payload.requestedBy },
						{ label: "Date issued", value: formatCalendarDate(payload.dateIssued) },
						{ label: "Issuing station", value: payload.issuingStation },
					],
				},
			],
			note: "This certifies that the Bureau of Quarantine cleared the remains described above for transport.",
		},
		extras
	)
}

export const humanRemains: DocumentTypeDefinition<HumanRemainsDetails> = {
	type: "human-remains",
	title: DOCUMENT_NAME,
	// Assumed prefix until BOQ signs off the numbering (PRD open item 6).
	numberPrefix: "HRC",
	sensitive: true,
	buildPayload: context => ({ ...buildHumanRemainsPayload(context) }),
	// A clearance for one transport: it does not expire.
	validUntil: () => null,
	draw: (doc, payload, extras) =>
		drawHumanRemains(doc, payload as unknown as HumanRemainsPayload, extras),
}
