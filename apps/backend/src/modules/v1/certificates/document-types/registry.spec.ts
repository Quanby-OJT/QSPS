import { documentTypeFor, isVaccinationType, serviceDocumentTypeFor } from "./registry"

describe("document type registry (CRT-5)", () => {
	it.each(["sanitary-permit", "ship-sanitation"])("knows %s, so its PDF can be drawn", type => {
		expect(documentTypeFor(type)?.type).toBe(type)
	})

	it.each(["icv-record", "sanitary-permit", "ship-sanitation"])("lets a Service issue %s", type => {
		expect(serviceDocumentTypeFor(type)?.type).toBe(type)
	})

	it("still never lets a Service issue a medical exemption (CRT-3)", () => {
		expect(documentTypeFor("medical-exemption")).toBeDefined()
		expect(serviceDocumentTypeFor("medical-exemption")).toBeUndefined()
	})

	it("does not treat sanitation as a vaccination, so no exemption applies", () => {
		expect(isVaccinationType("icv-record")).toBe(true)
		expect(isVaccinationType("sanitary-permit")).toBe(false)
		expect(isVaccinationType("ship-sanitation")).toBe(false)
	})

	it("refuses a type nobody registered", () => {
		expect(documentTypeFor("haccp")).toBeUndefined()
		expect(serviceDocumentTypeFor(null)).toBeUndefined()
	})
})
