import {
	computeEntryHash,
	verifyChain,
	type ChainedFields,
	type ChainedRow,
} from "@/common/audit/audit-chain"

/** Pure checks of the hash chain (FND-3). No database: the rows are built here. */

function fields(overrides: Partial<ChainedFields> = {}): ChainedFields {
	return {
		domain: "rbac",
		action: "role.assign",
		outcome: "success",
		actorId: "actor-1",
		actorRole: "System Admin",
		targetType: "user",
		targetId: "user-1",
		oldValue: { roleHeld: false },
		newValue: { roleHeld: true, roleName: "Cashier" },
		reason: null,
		ipAddress: "203.0.113.7",
		userAgent: "jest",
		createdAt: new Date("2026-11-21T03:00:00.000Z"),
		...overrides,
	}
}

/** Build a valid chain of `count` rows, optionally after some pre-FND-3 rows. */
function chain(count: number, legacy = 0): ChainedRow[] {
	const rows: ChainedRow[] = []
	let id = 1
	for (let i = 0; i < legacy; i++) {
		rows.push({ id: id++, ...fields({ targetId: `old-${i}` }), prevHash: null, entryHash: null })
	}
	let prevHash: string | null = null
	for (let i = 0; i < count; i++) {
		const f = fields({ targetId: `user-${i}` })
		const entryHash = computeEntryHash(prevHash, f)
		rows.push({ id: id++, ...f, prevHash, entryHash })
		prevHash = entryHash
	}
	return rows
}

describe("computeEntryHash", () => {
	it("is a 64-character hex sha256", () => {
		expect(computeEntryHash(null, fields())).toMatch(/^[0-9a-f]{64}$/)
	})

	it("does not depend on JSON key order, which jsonb does not keep", () => {
		const a = computeEntryHash(null, fields({ newValue: { a: 1, b: { c: 2, d: 3 } } }))
		const b = computeEntryHash(null, fields({ newValue: { b: { d: 3, c: 2 }, a: 1 } }))
		expect(a).toBe(b)
	})

	it("changes when any field or the previous hash changes", () => {
		const base = computeEntryHash(null, fields())
		expect(computeEntryHash(null, fields({ reason: "x" }))).not.toBe(base)
		expect(computeEntryHash(null, fields({ ipAddress: "198.51.100.1" }))).not.toBe(base)
		expect(computeEntryHash("a".repeat(64), fields())).not.toBe(base)
	})
})

describe("verifyChain", () => {
	it("passes an intact chain and counts the rows from before it started", () => {
		expect(verifyChain(chain(5, 3))).toEqual({ ok: true, checked: 5, beforeChain: 3 })
	})

	it("reports the first entry whose contents were changed", () => {
		const rows = chain(5)
		rows[2] = { ...rows[2]!, reason: "edited outside the application" }

		expect(verifyChain(rows)).toMatchObject({ ok: false, brokenId: 3, checked: 2 })
	})

	it("reports a removed entry at the row after the gap", () => {
		const rows = chain(5)
		rows.splice(2, 1)

		expect(verifyChain(rows)).toMatchObject({ ok: false, brokenId: 4 })
	})

	it("reports an unhashed entry after the chain has started", () => {
		const rows = chain(3)
		rows.push({ id: 4, ...fields(), prevHash: null, entryHash: null })

		expect(verifyChain(rows)).toMatchObject({ ok: false, brokenId: 4 })
	})
})
