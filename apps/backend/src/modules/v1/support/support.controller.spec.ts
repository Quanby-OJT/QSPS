import type { PolicyService } from "@/common/policy/policy.service"
import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { SupportController } from "./support.controller"

jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))

jest.mock("@orpc/server", () => ({
	implement: jest.fn(() => ({
		handler: jest.fn((fn: () => unknown) => fn()),
	})),
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
	}
})

jest.mock("@/config/api-versions.config", () => ({
	v1: { support: { contacts: {} } },
}))

jest.mock("@/common/policy/policy.service", () => ({
	PolicyService: jest.fn(),
}))

describe("SupportController (ADM-8)", () => {
	it("makes the contacts route public, with no permission key", () => {
		const { anonymousRoutes } = jest.requireMock<{ anonymousRoutes: string[] }>(
			"@thallesp/nestjs-better-auth"
		)
		expect(anonymousRoutes).toEqual(["contacts"])
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, SupportController.prototype.contacts)
		).toBeUndefined()
	})

	it("answers with the published channels", async () => {
		const contacts = {
			phone: "+63 2 8123 4567",
			email: null,
			ticketUrl: "https://help.example.gov.ph",
			hours: null,
		}
		const supportContacts = jest.fn().mockResolvedValue(contacts)
		const controller = new SupportController({ supportContacts } as unknown as PolicyService)

		await expect(controller.contacts()).resolves.toEqual(contacts)
		expect(supportContacts).toHaveBeenCalledTimes(1)
	})
})
