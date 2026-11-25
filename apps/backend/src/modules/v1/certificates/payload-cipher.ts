import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

/**
 * Encryption of a document's payload at rest (CRT-7). The payload of a human
 * remains or biological substance document holds a deceased person's name and
 * cause of death or a specimen's details, so it is stored encrypted in the
 * `documents.payload` column (jsonb): the column holds a small sealed envelope
 * instead of the readable fields.
 *
 * AES-256-GCM, a fresh random 96-bit IV for every document, and the document's
 * type and number bound in as additional authenticated data, so a sealed
 * payload copied into another row, or altered, fails to open instead of
 * printing the wrong person's details.
 *
 * The key is `DOCUMENT_PAYLOAD_KEY` (32 random bytes, base64). Nothing here
 * reads the environment: callers pass the key in, which keeps this file
 * testable and free of the settings module.
 */
const ALGORITHM = "aes-256-gcm"
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const SEALED_VERSION = 1

/** What the `payload` column holds for an encrypted document. Every field is base64 text. */
export type SealedPayload = {
	v: typeof SEALED_VERSION
	alg: typeof ALGORITHM
	iv: string
	tag: string
	data: string
}

/** The key is missing or malformed: a server setting to fix, never something a user did. */
export class PayloadKeyError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "PayloadKeyError"
	}
}

/** A sealed payload would not open: the wrong key, or data that was changed after it was stored. */
export class PayloadDecryptError extends Error {
	constructor() {
		super("The document's stored details could not be decrypted")
		this.name = "PayloadDecryptError"
	}
}

/** The 32-byte key from `DOCUMENT_PAYLOAD_KEY` (base64), or a `PayloadKeyError` that says how to fix it. */
export function parsePayloadKey(value: string | undefined): Buffer {
	if (!value) {
		throw new PayloadKeyError(
			"DOCUMENT_PAYLOAD_KEY is not set, so human remains and biological substance documents cannot be stored or read. " +
				"Generate a key with: openssl rand -base64 32"
		)
	}
	const key = Buffer.from(value, "base64")
	if (key.length !== KEY_BYTES) {
		throw new PayloadKeyError(
			"DOCUMENT_PAYLOAD_KEY must be 32 random bytes in base64. Generate one with: openssl rand -base64 32"
		)
	}
	return key
}

/** What is bound to a stored payload: the document's type and number. */
export function payloadAad(documentType: string, documentNumber: string): string {
	return `${documentType}:${documentNumber}`
}

/** Whether `value` is the sealed envelope rather than a readable payload. */
export function isSealedPayload(value: unknown): value is SealedPayload {
	if (typeof value !== "object" || value === null) return false
	const candidate = value as Record<string, unknown>
	return (
		candidate.v === SEALED_VERSION &&
		candidate.alg === ALGORITHM &&
		typeof candidate.iv === "string" &&
		typeof candidate.tag === "string" &&
		typeof candidate.data === "string"
	)
}

/** Encrypts a payload for storage. */
export function sealPayload(
	payload: Record<string, unknown>,
	key: Buffer,
	aad: string
): SealedPayload {
	const iv = randomBytes(IV_BYTES)
	const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
	cipher.setAAD(Buffer.from(aad, "utf8"))
	const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()])
	return {
		v: SEALED_VERSION,
		alg: ALGORITHM,
		iv: iv.toString("base64"),
		tag: cipher.getAuthTag().toString("base64"),
		data: data.toString("base64"),
	}
}

/**
 * The readable payload of a stored one. A payload that is not sealed (every
 * document of the other types, and anything stored before CRT-7) is returned
 * as it is, and `getKey` is not called, so those never need the key.
 */
export function openPayload(
	stored: Record<string, unknown>,
	getKey: () => Buffer,
	aad: string
): Record<string, unknown> {
	if (!isSealedPayload(stored)) return stored
	const key = getKey()
	try {
		const iv = Buffer.from(stored.iv, "base64")
		const tag = Buffer.from(stored.tag, "base64")
		if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new PayloadDecryptError()
		const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
		decipher.setAAD(Buffer.from(aad, "utf8"))
		decipher.setAuthTag(tag)
		const text = Buffer.concat([
			decipher.update(Buffer.from(stored.data, "base64")),
			decipher.final(),
		]).toString("utf8")
		const parsed: unknown = JSON.parse(text)
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new PayloadDecryptError()
		}
		return parsed as Record<string, unknown>
	} catch {
		throw new PayloadDecryptError()
	}
}
