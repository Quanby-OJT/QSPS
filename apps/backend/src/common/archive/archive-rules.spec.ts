import { assertStorageKey } from "@/common/storage/file-storage"

import {
	archiveKey,
	decodeArchive,
	encodeArchive,
	retentionCutoff,
	sha256Hex,
} from "./archive-rules"

const now = new Date("2026-11-27T18:00:00.000Z")

describe("retentionCutoff", () => {
	it("is off for 0", () => {
		expect(retentionCutoff(now, 0)).toBeNull()
	})
	it("counts whole days back from now", () => {
		expect(retentionCutoff(now, 30)?.toISOString()).toBe("2026-10-28T18:00:00.000Z")
	})
})

describe("archiveKey", () => {
	it("is a valid storage key that names the class, run and id range", () => {
		const key = archiveKey("audit_log", now, 1, 250)
		expect(key).toBe("archive/audit_log/20261127T180000Z-1-250.jsonl.gz")
		expect(() => assertStorageKey(key)).not.toThrow()
	})
})

describe("encodeArchive and decodeArchive", () => {
	const rows = [
		{ id: 1, action: "role.assign", createdAt: new Date("2026-01-01T00:00:00.000Z") },
		{ id: 2, action: "role.remove", createdAt: new Date("2026-01-02T00:00:00.000Z") },
	]

	it("round-trips every row, with dates as ISO text", () => {
		expect(decodeArchive(encodeArchive(rows))).toEqual([
			{ id: 1, action: "role.assign", createdAt: "2026-01-01T00:00:00.000Z" },
			{ id: 2, action: "role.remove", createdAt: "2026-01-02T00:00:00.000Z" },
		])
	})

	it("gives a checksum that changes when a byte changes", () => {
		const bytes = encodeArchive(rows)
		const changed = new Uint8Array(bytes)
		changed[changed.length - 1] = (changed[changed.length - 1]! + 1) % 256
		expect(sha256Hex(bytes)).toHaveLength(64)
		expect(sha256Hex(changed)).not.toBe(sha256Hex(bytes))
	})
})
