import { documentTypeFor, isVaccinationType, serviceDocumentTypeFor } from "./registry"

describe("document type registry (CRT-5, CRT-6, CRT-7)", () => {
	it.each([
		"sanitary-permit",
		"ship-sanitation",
		"food-safety-training",
		"haccp",
		"human-remains",
		"biological-certification",
		"biological-permit",
	])("knows %s, so its PDF can be drawn", type => {
		expect(documentTypeFor(type)?.type).toBe(type)
	})

	it.each([
		"icv-record",
		"sanitary-permit",
		"ship-sanitation",
		"food-safety-training",
		"haccp",
		"human-remains",
		"biological-certification",
		"biological-permit",
	])("lets a Service issue %s", type => {
		expect(serviceDocumentTypeFor(type)?.type).toBe(type)
	})

	it("numbers the food safety documents with their own prefixes (CRT-6)", () => {
		expect(documentTypeFor("food-safety-training")?.numberPrefix).toBe("FST")
		expect(documentTypeFor("haccp")?.numberPrefix).toBe("HCP")
	})

	it("numbers the human remains and biological documents with their own prefixes (CRT-7)", () => {
		expect(documentTypeFor("human-remains")?.numberPrefix).toBe("HRC")
		expect(documentTypeFor("biological-certification")?.numberPrefix).toBe("BCT")
		expect(documentTypeFor("biological-permit")?.numberPrefix).toBe("BPM")
	})

	it("marks exactly the human remains and biological types as sensitive, so they are stored encrypted (CRT-7)", () => {
		for (const type of ["human-remains", "biological-certification", "biological-permit"]) {
			expect(documentTypeFor(type)?.sensitive).toBe(true)
		}
		for (const type of [
			"icv-record",
			"medical-exemption",
			"sanitary-permit",
			"ship-sanitation",
			"food-safety-training",
			"haccp",
		]) {
			expect(documentTypeFor(type)?.sensitive).toBeFalsy()
		}
	})

	it("still never lets a Service issue a medical exemption (CRT-3)", () => {
		expect(documentTypeFor("medical-exemption")).toBeDefined()
		expect(serviceDocumentTypeFor("medical-exemption")).toBeUndefined()
	})

	it("does not treat any of the newer types as a vaccination, so no exemption applies", () => {
		expect(isVaccinationType("icv-record")).toBe(true)
		for (const type of [
			"sanitary-permit",
			"ship-sanitation",
			"food-safety-training",
			"haccp",
			"human-remains",
			"biological-certification",
			"biological-permit",
		]) {
			expect(isVaccinationType(type)).toBe(false)
		}
	})

	it("refuses a type nobody registered", () => {
		expect(documentTypeFor("not-a-document")).toBeUndefined()
		expect(serviceDocumentTypeFor(null)).toBeUndefined()
	})
})
