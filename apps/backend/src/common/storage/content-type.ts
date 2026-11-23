import type { FormUploadContentType } from "@repo/contracts"

const SIGNATURES: readonly [FormUploadContentType, readonly number[]][] = [
	["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
	["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
	["image/jpeg", [0xff, 0xd8, 0xff]],
]

/**
 * The accepted type a file really is, read from its first bytes, or null.
 * The type a browser declares is only a claim; this is what is checked.
 */
export function sniffContentType(bytes: Uint8Array): FormUploadContentType | null {
	for (const [type, signature] of SIGNATURES) {
		if (bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte)) {
			return type
		}
	}
	return null
}
