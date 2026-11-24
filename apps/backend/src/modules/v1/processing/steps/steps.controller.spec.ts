import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import type { ServiceStepsService } from "./service-steps.service"
import type { StepResultsService } from "./step-results.service"
import { StepsController } from "./steps.controller"

jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))
jest.mock("@orpc/server", () => ({
	implement: jest.fn(() => ({ handler: jest.fn() })),
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options: { message: string; status?: number }
		) {
			super(options.message)
		}
		get status() {
			return this.code === "NOT_FOUND" ? 404 : 400
		}
	},
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({
	Session: () => () => undefined,
}))
jest.mock("@/config/api-versions.config", () => ({
	v1: { processing: { serviceSteps: {}, saveServiceSteps: {}, recordStepResult: {} } },
}))
// The interceptor and the services reach the database; these tests check the
// controller's permission metadata and the PDF route.
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))
jest.mock("./service-steps.service", () => ({ ServiceStepsService: jest.fn() }))
jest.mock("./step-results.service", () => ({ StepResultsService: jest.fn() }))

describe("StepsController (PRC-4)", () => {
	// RbacGuard reads this metadata: 403 plus a denied audit entry without the key.
	it.each([
		["list", "settings.services:manage"],
		["save", "settings.services:manage"],
		["record", "processing.assessments:perform"],
		["resultPdf", "processing.queue:read"],
	] as const)("%s requires %s", (method, key) => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, StepsController.prototype[method])
		).toEqual([key])
	})

	it("prints a step result in the caller's Scope, inline and never cached", async () => {
		const resultPdf = jest.fn().mockResolvedValue({
			fileName: "QSPS-261124-AB12CD-laboratory-v1-2026-11-24.pdf",
			pdf: Buffer.from("%PDF-1.3"),
		})
		const scope = { nationwide: false, entries: [{ serviceCategoryId: 1, locationId: 2 }] }
		const controller = new StepsController(
			{} as ServiceStepsService,
			{ resultPdf } as unknown as StepResultsService,
			{ resolve: jest.fn().mockResolvedValue(scope) }
		)
		const response = { setHeader: jest.fn(), end: jest.fn() }

		await controller.resultPdf(44, 3, response as never, "2", { user: { id: "staff-1" } } as never)

		expect(resultPdf).toHaveBeenCalledWith(44, 3, 2, "staff-1", scope)
		expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf")
		expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store")
		expect(response.end).toHaveBeenCalledWith(Buffer.from("%PDF-1.3"))
	})

	it("refuses a version that is not a positive whole number", async () => {
		const controller = new StepsController({} as ServiceStepsService, {} as StepResultsService)
		await expect(
			controller.resultPdf(44, 3, {} as never, "abc", { user: { id: "staff-1" } } as never)
		).rejects.toMatchObject({ status: 400 })
	})
})
