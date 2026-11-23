import { randomUUID } from "node:crypto"
import {
	copyFile,
	mkdir,
	readdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"

import {
	assertStorageKey,
	assertStoragePrefix,
	type FileStorage,
	type StoredFile,
} from "./file-storage"

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

	async copy(from: string, to: string): Promise<void> {
		const source = this.pathOf(from)
		const target = this.pathOf(to)
		await mkdir(dirname(target), { recursive: true })
		const temporary = `${target}.${randomUUID()}.tmp`
		await copyFile(source, temporary)
		await rename(temporary, target)
	}

	async delete(key: string): Promise<void> {
		try {
			await unlink(this.pathOf(key))
		} catch (error) {
			if (!isNotFound(error)) throw error
		}
	}

	async list(prefix: string): Promise<StoredFile[]> {
		assertStoragePrefix(prefix)
		const folder = this.pathOf(prefix.slice(0, -1))
		let names: string[]
		try {
			names = await readdir(folder, { recursive: true })
		} catch (error) {
			if (isNotFound(error)) return []
			throw error
		}

		const files: StoredFile[] = []
		for (const name of names) {
			try {
				const info = await stat(resolve(folder, name))
				if (!info.isFile()) continue
				files.push({ key: prefix + name.split(sep).join("/"), lastModified: info.mtime })
			} catch (error) {
				// Deleted between the listing and the stat: nothing to report.
				if (!isNotFound(error)) throw error
			}
		}
		return files
	}
}
