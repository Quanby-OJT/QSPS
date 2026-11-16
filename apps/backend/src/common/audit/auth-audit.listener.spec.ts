import { setAuthEventListener } from "@repo/auth/auth-events"

import { AuthAuditListener } from "./auth-audit.listener"

jest.mock("@repo/auth/auth-events", () => ({
	setAuthEventListener: jest.fn(),
}))

jest.mock("./audit.service", () => ({
	AuditService: jest.fn(),
}))

const register = setAuthEventListener as jest.MockedFunction<typeof setAuthEventListener>

describe("AuthAuditListener", () => {
	beforeEach(() => register.mockClear())

	it("registers on startup and unregisters on shutdown", () => {
		const listener = new AuthAuditListener({ record: jest.fn() } as never)

		listener.onModuleInit()
		expect(register).toHaveBeenCalledWith(expect.any(Function))

		listener.onModuleDestroy()
		expect(register).toHaveBeenLastCalledWith(null)
	})

	it.each(["user.registered", "user.email_verified", "session.created"] as const)(
		"records %s as an auth audit entry about the account",
		async type => {
			const record = jest.fn()
			const listener = new AuthAuditListener({ record } as never)

			await listener.record({ type, userId: "u1" })

			expect(record).toHaveBeenCalledWith({
				domain: "auth",
				action: type,
				actorId: "u1",
				targetType: "user",
				targetId: "u1",
			})
		}
	)
})
