import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { CertificatesController } from "./certificates.controller"
import { DocumentPdfController } from "./document-pdf.controller"
import type { DocumentService } from "./documents.service"

jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))
jest.mock("@orpc/server", () => ({
	implement: jest.fn(() => ({ handler: jest.fn() })),
}))
jest.mock("@thallesp/nestjs-better-auth", () => {
	// Records which methods are made public, so the test can check them.
	const anonymousRoutes: string[] = []
	return {
		anonymousRoutes,
		AllowAnonymous:
			() =>
			(_target: object, propertyKey: string): void => {
				anonymousRoutes.push(propertyKey)
			},
		Session: () => () => undefined,
	}
})
jest.mock("@/config/api-versions.config", () => ({
	v1: { certificates: { issue: {}, mine: {}, verify: {}, verifyByNumber: {} } },
}))
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))
jest.mock("./documents.service", () => ({
	DocumentService: jest.fn(),
}))

describe("Certificates permissions", () => {
	it("requires certificates.documents:issue to issue", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, CertificatesController.prototype.issue)
		).toEqual(["certificates.documents:issue"])
	})

	it("requires certificates.own:read for My Documents and the PDF", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, CertificatesController.prototype.mine)
		).toEqual(["certificates.own:read"])
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, DocumentPdfController.prototype.download)
		).toEqual(["certificates.own:read"])
	})

	it("requires certificates.documents:print to print (CRT-3)", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, DocumentPdfController.prototype.print)
		).toEqual(["certificates.documents:print"])
	})

	it("makes only the two verify routes public, with no permission key (CRT-2)", () => {
		const { anonymousRoutes } = jest.requireMock<{ anonymousRoutes: string[] }>(
			"@thallesp/nestjs-better-auth"
		)
		expect([...anonymousRoutes].sort()).toEqual(["verify", "verifyByNumber"])
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, CertificatesController.prototype.verify)
		).toBeUndefined()
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, CertificatesController.prototype.verifyByNumber)
		).toBeUndefined()
	})

	it("sends the PDF inline, uncached, under the document number", async () => {
		const renderForOwner = jest
			.fn()
			.mockResolvedValue({ fileName: "ICV-MNL-2026-000001.pdf", pdf: Buffer.from("%PDF-1.3") })
		const controller = new DocumentPdfController({ renderForOwner } as unknown as DocumentService)
		const response = { setHeader: jest.fn(), end: jest.fn() }

		await controller.download(5, response as never, { user: { id: "client-1" } } as never)

		expect(renderForOwner).toHaveBeenCalledWith(5, "client-1")
		expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store")
		expect(response.setHeader).toHaveBeenCalledWith(
			"Content-Disposition",
			'inline; filename="ICV-MNL-2026-000001.pdf"'
		)
		expect(response.end).toHaveBeenCalledWith(Buffer.from("%PDF-1.3"))
	})

	it("prints in the caller's Scope and returns the print count (CRT-3)", async () => {
		const printForStaff = jest.fn().mockResolvedValue({
			fileName: "ICV-MNL-2026-000001.pdf",
			pdf: Buffer.from("%PDF-1.3"),
			printCount: 2,
		})
		const scope = { nationwide: false, entries: [{ serviceCategoryId: 1, locationId: 2 }] }
		const resolver = { resolve: jest.fn().mockResolvedValue(scope) }
		const controller = new DocumentPdfController(
			{ printForStaff } as unknown as DocumentService,
			resolver
		)
		const response = { setHeader: jest.fn(), end: jest.fn() }

		await controller.print(5, response as never, { user: { id: "staff-1" } } as never)

		expect(resolver.resolve).toHaveBeenCalledWith("staff-1")
		expect(printForStaff).toHaveBeenCalledWith(5, "staff-1", scope)
		expect(response.setHeader).toHaveBeenCalledWith("X-Print-Count", "2")
		expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store")
		expect(response.end).toHaveBeenCalledWith(Buffer.from("%PDF-1.3"))
	})

	it("prints with no Scope when no resolver is wired in, so it fails closed", async () => {
		const printForStaff = jest.fn().mockResolvedValue({
			fileName: "x.pdf",
			pdf: Buffer.from("%PDF-1.3"),
			printCount: 1,
		})
		const controller = new DocumentPdfController({ printForStaff } as unknown as DocumentService)
		await controller.print(
			5,
			{ setHeader: jest.fn(), end: jest.fn() } as never,
			{ user: { id: "staff-1" } } as never
		)
		expect(printForStaff).toHaveBeenCalledWith(5, "staff-1", { nationwide: false, entries: [] })
	})
})
