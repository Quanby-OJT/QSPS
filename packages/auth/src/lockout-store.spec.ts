import { afterEach, describe, expect, it, vi } from "vitest"

import {
	createMemoryLockoutStore,
	lockoutKey,
	lockoutStore,
	setLockoutStore,
	type LockoutStore,
} from "./lockout-store.js"

function clock(start = 1_000_000) {
	let now = start
	return {
		now: () => now,
		advance: (ms: number) => {
			now += ms
		},
	}
}

describe("lockoutKey (AUTH-3)", () => {
	it("is the same for any spelling of one address", () => {
		expect(lockoutKey("  Admin@QSPS.local ")).toBe(lockoutKey("admin@qsps.local"))
	})
})

describe("createMemoryLockoutStore", () => {
	it("counts failures within the window and restarts after it", async () => {
		const time = clock()
		const store = createMemoryLockoutStore({ now: time.now })

		expect(await store.recordFailure("k", 60)).toBe(1)
		expect(await store.recordFailure("k", 60)).toBe(2)
		time.advance(60_000)
		expect(await store.recordFailure("k", 60)).toBe(1)
	})

	it("clears failures", async () => {
		const store = createMemoryLockoutStore({ now: clock().now })
		await store.recordFailure("k", 60)
		await store.clearFailures("k")

		expect(await store.recordFailure("k", 60)).toBe(1)
	})

	it("reports the seconds left on a lock, then nothing once it ends", async () => {
		const time = clock()
		const store = createMemoryLockoutStore({ now: time.now })

		expect(await store.lockedFor("k")).toBeNull()
		await store.lock("k", 900)
		expect(await store.lockedFor("k")).toBe(900)
		time.advance(600_000)
		expect(await store.lockedFor("k")).toBe(300)
		time.advance(300_000)
		expect(await store.lockedFor("k")).toBeNull()
	})

	it("keeps keys apart", async () => {
		const store = createMemoryLockoutStore({ now: clock().now })
		await store.lock("a", 60)

		expect(await store.lockedFor("b")).toBeNull()
	})
})

describe("lockoutStore", () => {
	afterEach(() => setLockoutStore(null))

	it("delegates to the registered store", async () => {
		const fake: LockoutStore = {
			recordFailure: vi.fn().mockResolvedValue(4),
			clearFailures: vi.fn().mockResolvedValue(undefined),
			lock: vi.fn().mockResolvedValue(undefined),
			lockedFor: vi.fn().mockResolvedValue(42),
		}
		setLockoutStore(fake)

		expect(await lockoutStore.recordFailure("k", 60)).toBe(4)
		expect(await lockoutStore.lockedFor("k")).toBe(42)
		expect(fake.recordFailure).toHaveBeenCalledWith("k", 60)
	})

	it("falls back to process memory after unregister", async () => {
		const fake: LockoutStore = {
			recordFailure: vi.fn(),
			clearFailures: vi.fn(),
			lock: vi.fn(),
			lockedFor: vi.fn(),
		}
		setLockoutStore(fake)
		setLockoutStore(null)

		expect(await lockoutStore.lockedFor("fallback-key")).toBeNull()
		expect(fake.lockedFor).not.toHaveBeenCalled()
	})
})