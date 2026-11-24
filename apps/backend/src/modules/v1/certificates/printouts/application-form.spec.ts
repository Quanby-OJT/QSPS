import { PdfService } from "@/common/pdf/pdf.service"

import {
	APPLICANT_TYPE_OPTIONS,
	APPLICANT_TYPE_QUESTION,
	applicantTypeOf,
	applicationSections,
	applicationTitle,
	drawApplicationForm,
	type ApplicationFormData,
} from "./application-form"

const data: ApplicationFormData = {
	variant: "local",
	referenceNumber: "QSPS-261124-AB12CD",
	serviceName: "Physical Examination",
	locationName: "BOQ Manila",
	profile: {
		name: "Juan Dela Cruz",
		email: "juan@example.com",
		mobile: null,
		birthDate: "1990-05-17",
		gender: "Male",
		nationality: "Filipino",
	},
	answers: {
		"Applicant type": "Local",
		"Purpose of examination": "Employment",
		"Do you have any allergies?": "No",
	},
}

describe("applicantTypeOf", () => {
	it("reads Local and Foreign from the applicant type answer", () => {
		expect(applicantTypeOf({ [APPLICANT_TYPE_QUESTION]: "Local" })).toBe("local")
		expect(applicantTypeOf({ [APPLICANT_TYPE_QUESTION]: "Foreign" })).toBe("foreign")
	})

	it("ignores case and extra spaces in the question and the answer", () => {
		expect(applicantTypeOf({ "  APPLICANT TYPE ": " foreign " })).toBe("foreign")
	})

	it("is null when the question is missing or the answer is something else", () => {
		expect(applicantTypeOf({})).toBeNull()
		expect(applicantTypeOf({ "Purpose of examination": "Local" })).toBeNull()
		expect(applicantTypeOf({ [APPLICANT_TYPE_QUESTION]: "Both" })).toBeNull()
	})

	it("accepts every option the seeded question offers", () => {
		for (const option of APPLICANT_TYPE_OPTIONS) {
			expect(applicantTypeOf({ [APPLICANT_TYPE_QUESTION]: option })).not.toBeNull()
		}
	})
})

describe("applicationTitle", () => {
	it("names the variant", () => {
		expect(applicationTitle("local")).toContain("LOCAL")
		expect(applicationTitle("foreign")).toContain("FOREIGN")
	})
})

describe("applicationSections", () => {
	it("fills the profile and shows a dash for what is missing", () => {
		const { profile } = applicationSections(data)
		expect(profile).toContainEqual(["Full name", "Juan Dela Cruz"])
		expect(profile).toContainEqual(["Date of birth", "1990-05-17"])
		expect(profile).toContainEqual(["Mobile number", "-"])
	})

	it("lists the answers in the order they were given", () => {
		const { answers } = applicationSections(data)
		expect(answers.map(([question]) => question)).toEqual([
			"Applicant type",
			"Purpose of examination",
			"Do you have any allergies?",
		])
	})
})

describe("drawApplicationForm", () => {
	const pdfService = new PdfService()

	it.each(["local", "foreign"] as const)("renders the %s form as a PDF", async variant => {
		const qrPng = await pdfService.qrPng(data.referenceNumber)
		const pdf = await pdfService.render({ title: "Application form" }, doc =>
			drawApplicationForm(doc, { ...data, variant }, qrPng)
		)
		expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
		expect(pdf.length).toBeGreaterThan(1000)
	})

	it("renders a form with no answers and with very long answers", async () => {
		const qrPng = await pdfService.qrPng(data.referenceNumber)
		const long: ApplicationFormData = {
			...data,
			answers: Object.fromEntries(
				Array.from({ length: 40 }, (_, index) => [`Question ${index + 1}`, "word ".repeat(80)])
			),
		}
		for (const form of [{ ...data, answers: {} }, long]) {
			const pdf = await pdfService.render({ title: "Application form" }, doc =>
				drawApplicationForm(doc, form, qrPng)
			)
			expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
		}
	})
})
