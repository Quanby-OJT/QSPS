import {
	isSealedPayload,
	openPayload,
	parsePayloadKey,
	payloadAad,
	PayloadDecryptError,
	PayloadKeyError,
	sealPayload,
} from "./payload-cipher"

const KEY_TEXT = Buffer.alloc(32, 7).toString("base64")
const OTHER_KEY_TEXT = Buffer.alloc(32, 9).toString("base64")
const key = () => parsePayloadKey(KEY_TEXT)
const aad = payloadAad("human-remains", "HRC-BCD-2026-000001")
const payload = {
	holder: { name: "Juan Dela Cruz" },
	deceased: { name: "Juan Dela Cruz", causeOfDeath: "Cardiac arrest" },
}

describe("payload encryption (CRT-7)", () => {
	describe("parsePayloadKey", () => {
		it("reads a 32-byte key written in base64", () => {
			expect(parsePayloadKey(KEY_TEXT)).toHaveLength(32)
		})

		it("says how to make a key when none is set", () => {
			expect(() => parsePayloadKey(undefined)).toThrow(PayloadKeyError)
			expect(() => parsePayloadKey("")).toThrow("openssl rand -base64 32")
		})

		it("refuses a key of the wrong length", () => {
			expect(() => parsePayloadKey(Buffer.alloc(16, 1).toString("base64"))).toThrow(PayloadKeyError)
			expect(() => parsePayloadKey("not a key")).toThrow(PayloadKeyError)
		})
	})

	describe("sealPayload and openPayload", () => {
		it("round-trips a payload", () => {
			const sealed = sealPayload(payload, key(), aad)
			expect(openPayload(sealed, key, aad)).toEqual(payload)
		})

		it("stores nothing readable: no field name or value shows in the sealed envelope", () => {
			const stored = JSON.stringify(sealPayload(payload, key(), aad))
			expect(stored).not.toContain("Juan")
			expect(stored).not.toContain("Cardiac")
			expect(stored).not.toContain("holder")
			expect(stored).not.toContain("causeOfDeath")
		})

		it("describes itself as AES-256-GCM, version 1, and is recognised as sealed", () => {
			const sealed = sealPayload(payload, key(), aad)
			expect(sealed).toMatchObject({ v: 1, alg: "aes-256-gcm" })
			expect(isSealedPayload(sealed)).toBe(true)
			expect(isSealedPayload(payload)).toBe(false)
			expect(isSealedPayload({ v: 1, alg: "aes-256-gcm" })).toBe(false)
		})

		it("uses a new IV every time, so the same payload never seals the same way twice", () => {
			const first = sealPayload(payload, key(), aad)
			const second = sealPayload(payload, key(), aad)
			expect(first.iv).not.toBe(second.iv)
			expect(first.data).not.toBe(second.data)
		})

		it("will not open with another key", () => {
			const sealed = sealPayload(payload, key(), aad)
			expect(() => openPayload(sealed, () => parsePayloadKey(OTHER_KEY_TEXT), aad)).toThrow(
				PayloadDecryptError
			)
		})

		it("will not open under another document's type or number, so a copied envelope fails", () => {
			const sealed = sealPayload(payload, key(), aad)
			expect(() =>
				openPayload(sealed, key, payloadAad("human-remains", "HRC-BCD-2026-000002"))
			).toThrow(PayloadDecryptError)
			expect(() =>
				openPayload(sealed, key, payloadAad("biological-permit", "HRC-BCD-2026-000001"))
			).toThrow(PayloadDecryptError)
		})

		it("will not open data that was changed after it was stored", () => {
			const sealed = sealPayload(payload, key(), aad)
			const bytes = Buffer.from(sealed.data, "base64")
			bytes[0] = (bytes[0] ?? 0) ^ 1
			expect(() => openPayload({ ...sealed, data: bytes.toString("base64") }, key, aad)).toThrow(
				PayloadDecryptError
			)
			const tag = Buffer.from(sealed.tag, "base64")
			tag[0] = (tag[0] ?? 0) ^ 1
			expect(() => openPayload({ ...sealed, tag: tag.toString("base64") }, key, aad)).toThrow(
				PayloadDecryptError
			)
		})

		it("refuses an envelope whose IV or tag has the wrong length", () => {
			const sealed = sealPayload(payload, key(), aad)
			expect(() => openPayload({ ...sealed, iv: "AAAA" }, key, aad)).toThrow(PayloadDecryptError)
			expect(() => openPayload({ ...sealed, tag: "AAAA" }, key, aad)).toThrow(PayloadDecryptError)
		})

		it("returns a readable payload as it is without asking for the key, so older documents need none", () => {
			const getKey = jest.fn(key)
			expect(openPayload(payload, getKey, aad)).toBe(payload)
			expect(getKey).not.toHaveBeenCalled()
		})

		it("asks for the key only when the payload is sealed", () => {
			const getKey = jest.fn(key)
			openPayload(sealPayload(payload, key(), aad), getKey, aad)
			expect(getKey).toHaveBeenCalledTimes(1)
		})
	})
})
