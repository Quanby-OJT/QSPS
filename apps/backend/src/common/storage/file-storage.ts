/**
 * Private file storage (FRM-2; AUTH-4 and BKG-6 reuse it). Keys are paths
 * such as `form-uploads/<userId>/<uuid>.pdf`. Nothing stored here is public:
 * files are read back only through the API, after its own permission checks.
 */
export interface FileStorage {
	/** Store the bytes under `key`, replacing any file already there. */
	put(key: string, body: Uint8Array, contentType: string): Promise<void>
	exists(key: string): Promise<boolean>
	/** The bytes, or null when nothing is stored under `key`. */
	read(key: string): Promise<Uint8Array | null>
}

/** Injection token for the configured `FileStorage`. */
export const FILE_STORAGE = Symbol("FILE_STORAGE")

/** Segments of letters, digits, `_` and `-` (dots allowed after the first character). */
const KEY_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/

/** Refuses keys that could leave the storage root or are not plain paths. */
export function assertStorageKey(key: string): void {
	if (key.length > 512 || !KEY_PATTERN.test(key) || key.split("/").includes("..")) {
		throw new Error(`Invalid storage key "${key}"`)
	}
}
