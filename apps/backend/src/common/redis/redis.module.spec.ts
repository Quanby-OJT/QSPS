import { setLockoutStore } from "@repo/auth/lockout-store"
import { setAuthRateLimitStorage } from "@repo/auth/rate-limit-storage"

import { RedisModule } from "@/common/redis/redis.module"
import type { RedisClient } from "@/common/redis/redis.provider"

jest.mock("@repo/auth/rate-limit-storage", () => ({
	...jest.requireActual("@repo/auth/rate-limit-storage"),
	setAuthRateLimitStorage: jest.fn(),
}))

jest.mock("@repo/auth/lockout-store", () => ({
	...jest.requireActual("@repo/auth/lockout-store"),
	setLockoutStore: jest.fn(),
}))

const register = setAuthRateLimitStorage as jest.MockedFunction<typeof setAuthRateLimitStorage>
const registerLockout = setLockoutStore as jest.MockedFunction<typeof setLockoutStore>

/**
 * RedisModule hands Better Auth's limiter the shared store, and takes it back
 * before the connection closes.
 */
describe("RedisModule auth rate-limit registration", () => {
	beforeEach(() => {
		register.mockClear()
		registerLockout.mockClear()
	})

	it("registers the auth storage when a client exists", async () => {
		const client = { status: "ready" } as unknown as RedisClient

		await new RedisModule(client).onModuleInit()

		expect(register).toHaveBeenCalledTimes(1)
		expect(register).toHaveBeenCalledWith(
			expect.objectContaining({ consume: expect.any(Function) })
		)
	})

	it("registers even when the client is not ready yet", async () => {
		// The storage fails open, so a slow handshake must not leave Better Auth
		// counting per process for the life of this instance.
		const client = { status: "end" } as unknown as RedisClient

		await new RedisModule(client).onModuleInit()

		expect(register).toHaveBeenCalledTimes(1)
	})

	it("does not register without a client", async () => {
		await new RedisModule(null).onModuleInit()

		expect(register).not.toHaveBeenCalled()
	})

	it("unregisters on shutdown", async () => {
		const client = { status: "ready", quit: jest.fn().mockResolvedValue("OK") }

		await new RedisModule(client as unknown as RedisClient).onApplicationShutdown()

		expect(register).toHaveBeenCalledWith(null)
		expect(client.quit).toHaveBeenCalled()
	})

	it("registers the sign-in lockout store too (AUTH-3), and takes it back on shutdown", async () => {
		const client = { status: "ready", quit: jest.fn().mockResolvedValue("OK") }
		const module = new RedisModule(client as unknown as RedisClient)

		await module.onModuleInit()
		expect(registerLockout).toHaveBeenCalledWith(
			expect.objectContaining({ lockedFor: expect.any(Function) })
		)

		await module.onApplicationShutdown()
		expect(registerLockout).toHaveBeenLastCalledWith(null)
	})

	it("leaves the lockout store in memory without a client", async () => {
		await new RedisModule(null).onModuleInit()

		expect(registerLockout).not.toHaveBeenCalled()
	})
})