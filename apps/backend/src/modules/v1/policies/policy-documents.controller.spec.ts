import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { PolicyDocumentsController } from "./policy-documents.controller"
import type { PolicyDocumentService } from "./policy-documents.service"

jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))

/** What the next oRPC handler call receives as its `{ input }`. */
let handlerInput: unknown

jest.mock("@orpc/server", () => ({
	implement: jest.fn(() => ({
		handler: jest.fn((fn: (options: { input: unknown }) => unknown) => fn({ input: handlerInput })),
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
		Session: () => () => undefined,
	}
})

jest.mock("@/config/api-versions.config", () => ({
	v1: { policyDocuments: { list: {}, create: {}, update: {}, withdraw: {}, published: {} } },
}))

jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))

jest.mock("./policy-documents.service", () => ({
	PolicyDocumentService: jest.fn(),
}))

function requiredPermissions(handler: keyof PolicyDocumentsController): unknown {
	return Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, PolicyDocumentsController.prototype[handler])
}

describe("PolicyDocumentsController (ADM-9)", () => {
	let service: Record<"list" | "create" | "update" | "withdraw" | "published", jest.Mock>
	let controller: PolicyDocumentsController

	beforeEach(() => {
		handlerInput = undefined
		service = {
			list: jest.fn(),
			create: jest.fn(),
			update: jest.fn(),
			withdraw: jest.fn(),
			published: jest.fn(),
		}
		controller = new PolicyDocumentsController(service as unknown as PolicyDocumentService)
	})

	// RbacGuard reads this metadata and answers 403 plus a denied Audit Entry
	// when the caller lacks the key (Flow A).
	it.each(["list", "create", "update", "withdraw"] as const)(
		"requires settings.policies:manage on %s",
		handler => {
			expect(requiredPermissions(handler)).toEqual(["settings.policies:manage"])
		}
	)

	it("makes only the published list public, with no permission key", () => {
		const { anonymousRoutes } = jest.requireMock<{ anonymousRoutes: string[] }>(
			"@thallesp/nestjs-better-auth"
		)
		expect(anonymousRoutes).toEqual(["published"])
		expect(requiredPermissions("published")).toBeUndefined()
	})

	it("attributes a new policy and a new version to the signed-in user", async () => {
		handlerInput = { title: "Terms" }
		await controller.create({ user: { id: "admin-1" } } as never)
		expect(service.create).toHaveBeenCalledWith({ title: "Terms" }, "admin-1")

		handlerInput = { documentKey: "key-a", title: "Terms" }
		await controller.update({ user: { id: "admin-1" } } as never)
		expect(service.update).toHaveBeenCalledWith({ documentKey: "key-a", title: "Terms" }, "admin-1")
	})

	it("withdraws by key", async () => {
		handlerInput = { documentKey: "key-a" }
		await controller.withdraw({ user: { id: "admin-1" } } as never)
		expect(service.withdraw).toHaveBeenCalledWith("key-a", "admin-1")
	})
})
