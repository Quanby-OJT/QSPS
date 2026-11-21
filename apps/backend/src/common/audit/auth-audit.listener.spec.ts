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

describe("AUTH-3 sign-in and password events", () => {
	async function recorded(event: Parameters<AuthAuditListener["record"]>[0]) {
		const record = jest.fn()
		await new AuthAuditListener({ record } as never).record(event)
		return record.mock.calls[0]?.[0]
	}

	it.each([
		["sign_in.failed", "wrong password"],
		["sign_in.locked", "account locked after repeated failed sign-ins"],
		["password.reuse_refused", "matches a recent password"],
	] as const)("records %s as denied", async (type, reason) => {
		await expect(recorded({ type, userId: "u1" })).resolves.toMatchObject({
			domain: "auth",
			action: type,
			outcome: "denied",
			targetId: "u1",
			reason,
		})
	})

	it("records a lock with its attempts and length", async () => {
		await expect(
			recorded({ type: "account.locked", userId: "u1", attempts: 5, minutes: 15 })
		).resolves.toMatchObject({
			action: "account.locked",
			outcome: "denied",
			newValue: { attempts: 5, minutes: 15 },
		})
	})

	it("records an expired staff password and a password change as successes", async () => {
		const expired = await recorded({ type: "password.expired", userId: "u1" })
		expect(expired).toMatchObject({ action: "password.expired" })
		expect(expired.outcome).toBeUndefined()

		await expect(recorded({ type: "password.changed", userId: "u1" })).resolves.toEqual({
			domain: "auth",
			action: "password.changed",
			actorId: "u1",
			targetType: "user",
			targetId: "u1",
		})
	})
})