import { Logger } from "@nestjs/common"
import type Redis from "ioredis"

// The subpath, not the package root: the root also loads the whole Better Auth config.
import { createMemoryLockoutStore, type LockoutStore } from "@repo/auth/lockout-store"

/**
 * Failed sign-in counts and account locks (AUTH-3) in the shared Redis, so a
 * lock holds on every instance and survives a restart.
 *
 * Degrades like the auth rate-limit store: while Redis is unreachable each
 * instance counts in its own memory. Letting every attempt through during an
 * outage would hand a password-guessing client the window it needs. Logged
 * once on loss and once on recovery.
 */

/** Kept apart from the throttler and rate-limit keys that share this connection. */
const FAILURES = "auth-lockout:failures:"
const LOCKS = "auth-lockout:lock:"

/**
 * KEYS[1] failures key, ARGV[1] window in seconds. Increments and, on the first
 * failure (or a key that lost its expiry), starts the window. Returns the count.
 */
export const RECORD_FAILURE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
`

export function createRedisLockoutStore(client: Redis): LockoutStore {
	const logger = new Logger("AuthLockoutStore")
	const fallback = createMemoryLockoutStore()
	let degraded = false

	const recovered = () => {
		if (!degraded) return
		degraded = false
		logger.log("Lockout store reachable again: sign-in locks are shared again")
	}

	const failed = (error: unknown) => {
		if (client.status === "end" || degraded) return
		degraded = true
		logger.error(
			`Lockout store unreachable (${
				error instanceof Error ? error.message : String(error)
			}): sign-in locks are counted per instance until it returns`
		)
	}

	return {
		async recordFailure(key, windowSeconds) {
			try {
				const count = (await client.eval(
					RECORD_FAILURE_SCRIPT,
					1,
					`${FAILURES}${key}`,
					String(windowSeconds)
				)) as number
				recovered()
				return Number(count)
			} catch (error) {
				failed(error)
				return fallback.recordFailure(key, windowSeconds)
			}
		},
		async clearFailures(key) {
			try {
				await client.del(`${FAILURES}${key}`)
				recovered()
			} catch (error) {
				failed(error)
			}
			await fallback.clearFailures(key)
		},
		async lock(key, seconds) {
			try {
				await client.set(`${LOCKS}${key}`, "1", "EX", seconds)
				recovered()
			} catch (error) {
				failed(error)
			}
			// Also locally, so the lock holds on this instance even if Redis fails later.
			await fallback.lock(key, seconds)
		},
		async lockedFor(key) {
			try {
				const ttl = await client.ttl(`${LOCKS}${key}`)
				recovered()
				if (ttl > 0) return ttl
				return fallback.lockedFor(key)
			} catch (error) {
				failed(error)
				return fallback.lockedFor(key)
			}
		},
	}
}