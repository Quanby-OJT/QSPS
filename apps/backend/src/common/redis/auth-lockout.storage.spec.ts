import { Logger } from "@nestjs/common"
import type Redis from "ioredis"

import {
	createRedisLockoutStore,
	RECORD_FAILURE_SCRIPT,
} from "@/common/redis/auth-lockout.storage"

/**
 * Sign-in lockout counted in the shared Redis (AUTH-3). The script runs against
 * a real Redis in the manual walk; these tests pin the commands and the fallback.
 */

function client(status = "ready") {
	return {
		eval: jest.fn(),
		del: jest.fn().mockResolvedValue(1),
		set: jest.fn().mockResolvedValue("OK"),
		ttl: jest.fn().mockResolvedValue(-2),
		status,
	} as unknown as Redis & {
		eval: jest.Mock
		del: jest.Mock
		set: jest.Mock
		ttl: jest.Mock
	}
}

let errorSpy: jest.SpyInstance

beforeEach(() => {
	errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => {})
	jest.spyOn(Logger.prototype, "log").mockImplementation(() => {})
})

afterEach(() => {
	jest.restoreAllMocks()
})

describe("createRedisLockoutStore", () => {
	it("counts failures with one atomic script and a namespaced key", async () => {
		const redis = client()
		redis.eval.mockResolvedValue(3)

		await expect(createRedisLockoutStore(redis).recordFailure("email:a@b.c", 900)).resolves.toBe(3)
		expect(redis.eval).toHaveBeenCalledWith(
			RECORD_FAILURE_SCRIPT,
			1,
			"auth-lockout:failures:email:a@b.c",
			"900"
		)
	})

	it("starts the window only when the key has no expiry", () => {
		expect(RECORD_FAILURE_SCRIPT).toContain("TTL")
		expect(RECORD_FAILURE_SCRIPT).toContain("EXPIRE")
	})

	it("locks with an expiring key and reads the seconds left", async () => {
		const redis = client()
		const store = createRedisLockoutStore(redis)

		await store.lock("email:a@b.c", 900)
		expect(redis.set).toHaveBeenCalledWith("auth-lockout:lock:email:a@b.c", "1", "EX", 900)

		redis.ttl.mockResolvedValue(840)
		await expect(store.lockedFor("email:a@b.c")).resolves.toBe(840)
	})

	it("reports no lock when the key is gone", async () => {
		await expect(createRedisLockoutStore(client()).lockedFor("k")).resolves.toBeNull()
	})

	it("clears the failure count", async () => {
		const redis = client()
		await createRedisLockoutStore(redis).clearFailures("k")

		expect(redis.del).toHaveBeenCalledWith("auth-lockout:failures:k")
	})

	it("keeps counting per process when Redis fails, and logs once", async () => {
		const redis = client()
		redis.eval.mockRejectedValue(new Error("Connection is closed."))
		const store = createRedisLockoutStore(redis)

		await expect(store.recordFailure("k", 60)).resolves.toBe(1)
		await expect(store.recordFailure("k", 60)).resolves.toBe(2)
		expect(errorSpy).toHaveBeenCalledTimes(1)
	})

	it("still holds a lock on this instance when Redis is down", async () => {
		const redis = client()
		redis.set.mockRejectedValue(new Error("down"))
		redis.ttl.mockRejectedValue(new Error("down"))
		const store = createRedisLockoutStore(redis)

		await store.lock("k", 900)
		await expect(store.lockedFor("k")).resolves.toBe(900)
	})

	it("does not log for a client closed on purpose", async () => {
		const redis = client("end")
		redis.eval.mockRejectedValue(new Error("Connection is closed."))

		await createRedisLockoutStore(redis).recordFailure("k", 60)
		expect(errorSpy).not.toHaveBeenCalled()
	})
})