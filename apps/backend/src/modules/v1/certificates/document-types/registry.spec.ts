import { documentTypeFor, isVaccinationType, serviceDocumentTypeFor } from "./registry"

describe("document type registry (CRT-5, CRT-6)", () => {
	it.each(["sanitary-permit", "ship-sanitation", "food-safety-training", "haccp"])(
		"knows %s, so its PDF can be drawn",
		type => {
			expect(documentTypeFor(type)?.type).toBe(type)
		}
	)

	it.each(["icv-record", "sanitary-permit", "ship-sanitation", "food-safety-training", "haccp"])(
		"lets a Service issue %s",
		type => {
			expect(serviceDocumentTypeFor(type)?.type).toBe(type)
		}
	)

	it("numbers the food safety documents with their own prefixes (CRT-6)", () => {
		expect(documentTypeFor("food-safety-training")?.numberPrefix).toBe("FST")
		expect(documentTypeFor("haccp")?.numberPrefix).toBe("HCP")
	})

	it("still never lets a Service issue a medical exemption (CRT-3)", () => {
		expect(documentTypeFor("medical-exemption")).toBeDefined()
		expect(serviceDocumentTypeFor("medical-exemption")).toBeUndefined()
	})

	it("does not treat sanitation or food safety as a vaccination, so no exemption applies", () => {
		expect(isVaccinationType("icv-record")).toBe(true)
		expect(isVaccinationType("sanitary-permit")).toBe(false)
		expect(isVaccinationType("ship-sanitation")).toBe(false)
		expect(isVaccinationType("food-safety-training")).toBe(false)
		expect(isVaccinationType("haccp")).toBe(false)
	})

	it("refuses a type nobody registered", () => {
		expect(documentTypeFor("human-remains")).toBeUndefined()
		expect(serviceDocumentTypeFor(null)).toBeUndefined()
	})
})
