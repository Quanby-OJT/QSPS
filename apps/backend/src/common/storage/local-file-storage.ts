import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"

import { assertStorageKey, type FileStorage } from "./file-storage"

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === "ENOENT"
	)
}

/**
 * `FileStorage` on the local disk, for development and tests. Files live under
 * one root folder that is never served by the web server. Writes go to a
 * temporary file first, so a half-written upload is never read.
 */
export class LocalFileStorage implements FileStorage {
	private readonly root: string

	constructor(root: string) {
		this.root = resolve(root)
	}

	private pathOf(key: string): string {
		assertStorageKey(key)
		const full = resolve(this.root, key)
		if (!full.startsWith(this.root + sep)) {
			throw new Error(`Invalid storage key "${key}"`)
		}
		return full
	}

	async put(key: string, body: Uint8Array): Promise<void> {
		const full = this.pathOf(key)
		await mkdir(dirname(full), { recursive: true })
		const temporary = `${full}.${randomUUID()}.tmp`
		await writeFile(temporary, body)
		await rename(temporary, full)
	}

	async exists(key: string): Promise<boolean> {
		try {
			return (await stat(this.pathOf(key))).isFile()
		} catch (error) {
			if (isNotFound(error)) return false
			throw error
		}
	}

	async read(key: string): Promise<Uint8Array | null> {
		try {
			return new Uint8Array(await readFile(this.pathOf(key)))
		} catch (error) {
			if (isNotFound(error)) return null
			throw error
		}
	}
}
