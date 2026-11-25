import type { PdfDocument } from "@/common/pdf/pdf.service"

/**
 * The Physical Examination application form (CRT-4, TOR §VIII.3), filled from
 * the client's profile and the questionnaire they answered while booking, so
 * nothing is retyped at the clinic. A printout, not an issued Document: no
 * Document Number and no `documents` row.
 *
 * ASSUMED until BOQ supplies its real forms (decision B4 in the PRD): the
 * layout below is a plain placeholder. The two variants differ only in the
 * title for now; the real Local and Foreign layouts replace `drawApplicationForm`.
 */
export type ApplicantType = "local" | "foreign"

/**
 * The questionnaire question that says whether the client is Local or
 * Foreign. The seeded Physical Examination questionnaire must use exactly
 * this wording, and the answer must be one of the options below.
 */
export const APPLICANT_TYPE_QUESTION = "Applicant type"
export const APPLICANT_TYPE_OPTIONS = ["Local", "Foreign"] as const

/**
 * Which form to print, from the client's own answer. Takes the readable
 * answers (question label to answer text), ignores case and extra spaces, and
 * returns null when the question is missing or answered with anything else, so
 * the caller can ask for a clear fix instead of guessing.
 */
export function applicantTypeOf(answers: Readonly<Record<string, string>>): ApplicantType | null {
	const wanted = APPLICANT_TYPE_QUESTION.toLowerCase()
	for (const [question, answer] of Object.entries(answers)) {
		if (question.trim().toLowerCase() !== wanted) continue
		const value = answer.trim().toLowerCase()
		if (value === "local") return "local"
		if (value === "foreign") return "foreign"
		return null
	}
	return null
}

export interface ApplicationFormData {
	variant: ApplicantType
	referenceNumber: string
	serviceName: string
	locationName: string
	profile: {
		name: string
		email: string
		mobile: string | null
		birthDate: string | null
		gender: string | null
		nationality: string | null
	}
	/** Question to answer text, in question order (from `readableAnswers`). */
	answers: Readonly<Record<string, string>>
}

export function applicationTitle(variant: ApplicantType): string {
	return variant === "foreign"
		? "APPLICATION FORM FOR PHYSICAL EXAMINATION (FOREIGN)"
		: "APPLICATION FORM FOR PHYSICAL EXAMINATION (LOCAL)"
}

/** The rows printed in each part of the form, apart from drawing so they can be tested. */
export function applicationSections(data: ApplicationFormData): {
	profile: [string, string][]
	answers: [string, string][]
} {
	const dash = (value: string | null): string => (value && value.trim() !== "" ? value : "-")
	return {
		profile: [
			["Full name", dash(data.profile.name)],
			["Date of birth", dash(data.profile.birthDate)],
			["Gender", dash(data.profile.gender)],
			["Nationality", dash(data.profile.nationality)],
			["Mobile number", dash(data.profile.mobile)],
			["Email", dash(data.profile.email)],
		],
		answers: Object.entries(data.answers),
	}
}

const LEFT = 50
const WIDTH = 495
const LABEL_WIDTH = 170
const VALUE_X = 225
const VALUE_WIDTH = 320
const PAGE_BOTTOM = 750

function drawSection(
	doc: PdfDocument,
	title: string,
	rows: [string, string][],
	startY: number
): number {
	let y = startY
	if (y > PAGE_BOTTOM - 40) {
		doc.addPage()
		y = 50
	}
	doc.font("Helvetica-Bold").fontSize(10).text(title, LEFT, y)
	y += 14
	doc
		.lineWidth(0.5)
		.moveTo(LEFT, y)
		.lineTo(LEFT + WIDTH, y)
		.stroke("#000000")
	y += 6

	for (const [label, value] of rows) {
		doc.font("Helvetica").fontSize(9)
		const labelHeight = doc.heightOfString(label, { width: LABEL_WIDTH })
		doc.font("Helvetica-Bold")
		const valueHeight = doc.heightOfString(value, { width: VALUE_WIDTH })
		const height = Math.max(labelHeight, valueHeight)
		if (y + height > PAGE_BOTTOM) {
			doc.addPage()
			y = 50
		}
		doc.font("Helvetica").text(label, LEFT, y, { width: LABEL_WIDTH })
		doc.font("Helvetica-Bold").text(value, VALUE_X, y, { width: VALUE_WIDTH })
		y += height + 6
	}
	return y
}

/** Draw the application form on A4. The QR code holds the Reference Number. */
export function drawApplicationForm(
	doc: PdfDocument,
	data: ApplicationFormData,
	qrPng: Buffer
): void {
	const sections = applicationSections(data)

	doc.fillColor("#000000")
	doc.font("Helvetica-Bold").fontSize(11).text("BUREAU OF QUARANTINE", LEFT, 50, {
		width: WIDTH,
		align: "center",
	})
	doc.fontSize(13).text(applicationTitle(data.variant), LEFT, 68, { width: WIDTH, align: "center" })
	doc.font("Helvetica").fontSize(9).text(`${data.serviceName} - ${data.locationName}`, LEFT, 90, {
		width: WIDTH,
		align: "center",
	})

	doc.font("Helvetica").fontSize(9).text("Reference Number", LEFT, 118)
	doc.font("Helvetica-Bold").fontSize(13).text(data.referenceNumber, LEFT, 131)
	doc.image(qrPng, 475, 108, { width: 70, height: 70 })

	let y = 195
	y = drawSection(doc, "Applicant", sections.profile, y)
	const answers: [string, string][] =
		sections.answers.length > 0 ? sections.answers : [["No answers recorded", "-"]]
	y = drawSection(doc, "Questionnaire", answers, y + 10)

	// Signature lines.
	if (y > PAGE_BOTTOM - 70) {
		doc.addPage()
		y = 50
	}
	y += 45
	doc.lineWidth(0.5)
	doc
		.moveTo(LEFT, y)
		.lineTo(LEFT + 220, y)
		.stroke("#000000")
	doc
		.moveTo(LEFT + 300, y)
		.lineTo(LEFT + 445, y)
		.stroke("#000000")
	doc.font("Helvetica").fontSize(8)
	doc.text("Signature of applicant", LEFT, y + 4)
	doc.text("Date", LEFT + 300, y + 4)
}
