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
	/** Copy `from` to `to`, replacing any file at `to`. Throws when `from` is missing. */
	copy(from: string, to: string): Promise<void>
	/** Delete `key`. Deleting a file that is already gone is not an error. */
	delete(key: string): Promise<void>
	/** Every file under `prefix` (a folder ending in "/"), with when it was last written. */
	list(prefix: string): Promise<StoredFile[]>
}

export interface StoredFile {
	key: string
	lastModified: Date
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

/** A folder to list: a valid key followed by "/". */
export function assertStoragePrefix(prefix: string): void {
	if (!prefix.endsWith("/")) {
		throw new Error(`Invalid storage prefix "${prefix}"`)
	}
	assertStorageKey(prefix.slice(0, -1))
}
