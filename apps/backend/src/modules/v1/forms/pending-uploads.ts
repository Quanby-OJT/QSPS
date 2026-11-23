/** Where file answers wait until the answers that use them are saved (FRM-2b). */
export const PENDING_UPLOAD_PREFIX = "form-uploads/pending/"

/** A pending upload older than this is deleted by the daily cleanup. */
export const PENDING_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** True for `form-uploads/pending/<userId>/<file>`. */
export function isPendingUploadKey(key: string): boolean {
	const parts = key.split("/")
	return parts.length === 4 && parts[0] === "form-uploads" && parts[1] === "pending"
}

/**
 * The user folder an upload key belongs to: `form-uploads/pending/<userId>/<file>`
 * or `form-uploads/<userId>/<file>`. Null for anything else. Counting the
 * segments means a user whose id is literally "pending" cannot claim others' files.
 */
export function uploadOwnerOf(key: string): string | null {
	const parts = key.split("/")
	if (parts[0] !== "form-uploads") return null
	if (parts.length === 4 && parts[1] === "pending") return parts[2] ?? null
	if (parts.length === 3) return parts[1] ?? null
	return null
}

/** `form-uploads/pending/<userId>/<file>` → `form-uploads/<userId>/<file>`. */
export function confirmedKeyOf(pendingKey: string): string {
	if (!isPendingUploadKey(pendingKey)) {
		throw new Error(`Not a pending upload key: "${pendingKey}"`)
	}
	return `form-uploads/${pendingKey.slice(PENDING_UPLOAD_PREFIX.length)}`
}
