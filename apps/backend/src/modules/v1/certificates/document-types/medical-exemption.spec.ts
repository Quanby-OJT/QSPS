import { PdfService } from "@/common/pdf/pdf.service"

import {
	buildMedicalExemptionPayload,
	drawMedicalExemption,
	medicalExemption,
} from "./medical-exemption"
import {
	documentTypeFor,
	isVaccinationType,
	medicalExemption as registered,
	serviceDocumentTypeFor,
} from "./registry"

const context = {
	holder: { name: "Test Three", birthDate: "2003-07-12", gender: "Male", nationality: "Filipino" },
	serviceName: "Yellow fever vaccination",
	locationName: "BOQ Manila",
	// 16:30 UTC on 18 Nov is 00:30 on 19 Nov in Manila.
	issuedAt: new Date("2026-11-18T16:30:00.000Z"),
}

const details = {
	reason: "Egg allergy (anaphylaxis)",
	physicianName: "Dr. Santos",
	validFrom: "2026-11-19",
	validUntil: "2027-11-18",
	passportOrIdNumber: null,
}

describe("medical-exemption document type (CRT-3)", () => {
	it("is registered under its DOMAIN-MODEL name with its own number prefix", () => {
		expect(documentTypeFor("medical-exemption")).toBe(medicalExemption)
		expect(registered).toBe(medicalExemption)
		expect(medicalExemption.numberPrefix).toBe("MEC")
		expect(medicalExemption.card).toBeUndefined()
	})

	it("is never a Service's own type, and applies only to vaccinations", () => {
		expect(serviceDocumentTypeFor("medical-exemption")).toBeUndefined()
		expect(serviceDocumentTypeFor("icv-record")?.type).toBe("icv-record")
		expect(isVaccinationType("icv-record")).toBe(true)
		expect(isVaccinationType("medical-exemption")).toBe(false)
		expect(isVaccinationType(null)).toBe(false)
	})

	it("copies the holder, the vaccine and the staff-entered reason", () => {
		expect(buildMedicalExemptionPayload(context, details)).toEqual({
			holder: {
				name: "Test Three",
				birthDate: "2003-07-12",
				sex: "Male",
				nationality: "Filipino",
				passportOrIdNumber: null,
			},
			exemptFrom: "Yellow fever vaccination",
			reason: "Egg allergy (anaphylaxis)",
			physicianName: "Dr. Santos",
			dateIssued: "2026-11-19",
			validFrom: "2026-11-19",
			validUntil: "2027-11-18",
			issuingStation: "BOQ Manila",
		})
		expect(medicalExemption.validUntil(details)).toBe("2027-11-18")
		expect(medicalExemption.validUntil({ ...details, validUntil: null })).toBeNull()
	})

	it("draws every field onto a real PDF", async () => {
		const pdf = new PdfService()
		const qrPng = await pdf.qrPng("http://localhost:3001/verify/token")
		const lines: string[] = []
		const bytes = await pdf.render({ title: "MEC" }, doc => {
			const original = doc.text.bind(doc) as (...args: unknown[]) => PDFKit.PDFDocument
			jest.spyOn(doc, "text").mockImplementation(((...args: unknown[]) => {
				lines.push(String(args[0]))
				return original(...args)
			}) as never)
			drawMedicalExemption(doc, buildMedicalExemptionPayload(context, details), {
				documentNumber: "MEC-MNL-2026-000001",
				status: "valid",
				verifyUrl: "http://localhost:3001/verify/token",
				qrPng,
			})
		})
		expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-")
		expect(lines).toEqual(
			expect.arrayContaining([
				"Medical Exemption Certificate",
				"MEC-MNL-2026-000001",
				"Test Three",
				"Yellow fever vaccination",
				"Egg allergy (anaphylaxis)",
				"Dr. Santos",
				"November 18, 2027",
				"BOQ Manila",
			])
		)
	})
})
