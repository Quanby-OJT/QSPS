/**
 * Failed sign-in counts and account locks (AUTH-3, TOR §VIII.1 brute force).
 *
 * Counted per normalised email, whether or not an account exists, so the lock
 * answer never tells a caller which addresses are registered.
 *
 * Same late binding as `rate-limit-storage.ts`: this package does not depend
 * on Redis, so the backend registers its Redis store with
 * {@link setLockoutStore} at startup. Until then (and in the CLI and tests)
 * counts live in process memory.
 */

export interface LockoutStore {
	/** Count one failed attempt. The count expires `windowSeconds` after the first failure. Returns the count. */
	recordFailure(key: string, windowSeconds: number): Promise<number>
	/** Forget the failures, e.g. after a successful sign-in or once a lock is set. */
	clearFailures(key: string): Promise<void>
	/** Lock the key for `seconds`. */
	lock(key: string, seconds: number): Promise<void>
	/** Seconds left on the lock, or null when not locked. */
	lockedFor(key: string): Promise<number | null>
}

/** One key per normalised email address. */
export function lockoutKey(email: string): string {
	return `email:${email.trim().toLowerCase()}`
}

const DEFAULT_MAX_ENTRIES = 100_000

/** Process-local store, bounded like the memory rate-limit store. */
export function createMemoryLockoutStore(options?: {
	maxEntries?: number
	now?: () => number
}): LockoutStore {
	const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES
	const now = options?.now ?? Date.now
	const failures = new Map<string, { count: number; expiresAt: number }>()
	const locks = new Map<string, number>()

	const bound = (map: Map<string, unknown>) => {
		for (const key of map.keys()) {
			if (map.size < maxEntries) break
			map.delete(key)
		}
	}

	return {
		async recordFailure(key, windowSeconds) {
			const at = now()
			const current = failures.get(key)
			if (current && at < current.expiresAt) {
				current.count += 1
				return current.count
			}
			failures.delete(key)
			bound(failures)
			failures.set(key, { count: 1, expiresAt: at + windowSeconds * 1000 })
			return 1
		},
		async clearFailures(key) {
			failures.delete(key)
		},
		async lock(key, seconds) {
			locks.delete(key)
			bound(locks)
			locks.set(key, now() + seconds * 1000)
		},
		async lockedFor(key) {
			const until = locks.get(key)
			if (until === undefined) return null
			const left = until - now()
			if (left <= 0) {
				locks.delete(key)
				return null
			}
			return Math.ceil(left / 1000)
		},
	}
}

let registered: LockoutStore | null = null
const fallback = createMemoryLockoutStore()

/** Register the shared store, or `null` to go back to process memory (on shutdown). */
export function setLockoutStore(store: LockoutStore | null): void {
	registered = store
}

/** The store the auth hooks use. Resolves the target on every call. */
export const lockoutStore: LockoutStore = {
	recordFailure: (key, windowSeconds) => (registered ?? fallback).recordFailure(key, windowSeconds),
	clearFailures: key => (registered ?? fallback).clearFailures(key),
	lock: (key, seconds) => (registered ?? fallback).lock(key, seconds),
	lockedFor: key => (registered ?? fallback).lockedFor(key),
}