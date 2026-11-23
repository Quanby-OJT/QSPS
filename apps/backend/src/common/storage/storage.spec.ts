import { mkdtemp, rm, utimes } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	CopyObjectCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
} from "@aws-sdk/client-s3"

import { sniffContentType } from "./content-type"
import { assertStorageKey, assertStoragePrefix } from "./file-storage"
import { LocalFileStorage } from "./local-file-storage"
import { S3FileStorage } from "./s3-file-storage"

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

describe("sniffContentType", () => {
	it("reads the type from the first bytes", () => {
		expect(sniffContentType(PDF)).toBe("application/pdf")
		expect(sniffContentType(PNG)).toBe("image/png")
		expect(sniffContentType(JPG)).toBe("image/jpeg")
		expect(sniffContentType(new TextEncoder().encode("MZ executable"))).toBeNull()
		expect(sniffContentType(new Uint8Array())).toBeNull()
	})
})

describe("assertStorageKey", () => {
	it("refuses keys that could leave the storage root", () => {
		expect(() => assertStorageKey("form-uploads/u1/a.pdf")).not.toThrow()
		expect(() => assertStorageKey("../etc/passwd")).toThrow()
		expect(() => assertStorageKey("form-uploads/../../x")).toThrow()
		expect(() => assertStorageKey("/absolute/path")).toThrow()
		expect(() => assertStorageKey("form-uploads\\u1\\a.pdf")).toThrow()
	})

	it("accepts only folder prefixes ending in a slash", () => {
		expect(() => assertStoragePrefix("form-uploads/pending/")).not.toThrow()
		expect(() => assertStoragePrefix("form-uploads/pending")).toThrow()
		expect(() => assertStoragePrefix("../")).toThrow()
		expect(() => assertStoragePrefix("/")).toThrow()
	})
})

describe("LocalFileStorage", () => {
	let root: string

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "qsps-storage-"))
	})
	afterEach(async () => {
		await rm(root, { recursive: true, force: true })
	})

	it("stores, finds and reads back a file", async () => {
		const storage = new LocalFileStorage(root)
		expect(await storage.exists("form-uploads/u1/a.pdf")).toBe(false)
		expect(await storage.read("form-uploads/u1/a.pdf")).toBeNull()

		await storage.put("form-uploads/u1/a.pdf", PDF)

		expect(await storage.exists("form-uploads/u1/a.pdf")).toBe(true)
		expect(await storage.read("form-uploads/u1/a.pdf")).toEqual(PDF)
	})

	it("refuses a key outside the root", async () => {
		const storage = new LocalFileStorage(root)
		await expect(storage.put("../outside.pdf", PDF)).rejects.toThrow("Invalid storage key")
	})

	it("copies a file and keeps the original", async () => {
		const storage = new LocalFileStorage(root)
		await storage.put("form-uploads/pending/u1/a.pdf", PDF)

		await storage.copy("form-uploads/pending/u1/a.pdf", "form-uploads/u1/a.pdf")

		expect(await storage.read("form-uploads/u1/a.pdf")).toEqual(PDF)
		expect(await storage.exists("form-uploads/pending/u1/a.pdf")).toBe(true)
	})

	it("refuses to copy a file that does not exist", async () => {
		const storage = new LocalFileStorage(root)
		await expect(
			storage.copy("form-uploads/pending/u1/x.pdf", "form-uploads/u1/x.pdf")
		).rejects.toThrow()
	})

	it("lists the files under a folder with when they were written, and deletes them", async () => {
		const storage = new LocalFileStorage(root)
		await storage.put("form-uploads/pending/u1/a.pdf", PDF)
		await storage.put("form-uploads/pending/u2/b.png", PNG)
		await storage.put("form-uploads/u1/c.pdf", PDF)
		const old = new Date("2026-11-01T00:00:00.000Z")
		await utimes(join(root, "form-uploads", "pending", "u1", "a.pdf"), old, old)

		const files = await storage.list("form-uploads/pending/")

		expect(files.map(file => file.key).sort()).toEqual([
			"form-uploads/pending/u1/a.pdf",
			"form-uploads/pending/u2/b.png",
		])
		expect(files.find(file => file.key.endsWith("a.pdf"))?.lastModified.getTime()).toBe(
			old.getTime()
		)

		await storage.delete("form-uploads/pending/u1/a.pdf")
		await storage.delete("form-uploads/pending/u1/a.pdf") // already gone: not an error
		expect(await storage.exists("form-uploads/pending/u1/a.pdf")).toBe(false)
		expect(await storage.exists("form-uploads/u1/c.pdf")).toBe(true)
	})

	it("lists nothing for a folder that does not exist", async () => {
		const storage = new LocalFileStorage(root)
		expect(await storage.list("form-uploads/pending/")).toEqual([])
	})
})

describe("S3FileStorage", () => {
	it("writes to the bucket with the content type", async () => {
		const send = jest.fn().mockResolvedValue({})
		await new S3FileStorage("qsps-private", { send } as never).put(
			"form-uploads/u1/a.pdf",
			PDF,
			"application/pdf"
		)
		const command = send.mock.calls[0]?.[0] as PutObjectCommand
		expect(command).toBeInstanceOf(PutObjectCommand)
		expect(command.input).toMatchObject({
			Bucket: "qsps-private",
			Key: "form-uploads/u1/a.pdf",
			ContentType: "application/pdf",
		})
		expect(command.input).not.toHaveProperty("ACL")
	})

	it("answers false and null for a missing object", async () => {
		const missing = Object.assign(new Error("not found"), {
			name: "NotFound",
			$metadata: { httpStatusCode: 404 },
		})
		const send = jest.fn().mockRejectedValue(missing)
		const storage = new S3FileStorage("qsps-private", { send } as never)

		expect(await storage.exists("form-uploads/u1/a.pdf")).toBe(false)
		expect(await storage.read("form-uploads/u1/a.pdf")).toBeNull()
		expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand)
		expect(send.mock.calls[1]?.[0]).toBeInstanceOf(GetObjectCommand)
	})

	it("passes other errors on", async () => {
		const send = jest.fn().mockRejectedValue(new Error("access denied"))
		const storage = new S3FileStorage("qsps-private", { send } as never)
		await expect(storage.exists("form-uploads/u1/a.pdf")).rejects.toThrow("access denied")
	})

	it("copies within the bucket, without a public ACL", async () => {
		const send = jest.fn().mockResolvedValue({})
		await new S3FileStorage("qsps-private", { send } as never).copy(
			"form-uploads/pending/u1/a.pdf",
			"form-uploads/u1/a.pdf"
		)
		const command = send.mock.calls[0]?.[0] as CopyObjectCommand
		expect(command).toBeInstanceOf(CopyObjectCommand)
		expect(command.input).toEqual({
			Bucket: "qsps-private",
			Key: "form-uploads/u1/a.pdf",
			CopySource: "qsps-private/form-uploads/pending/u1/a.pdf",
		})
	})

	it("deletes one object", async () => {
		const send = jest.fn().mockResolvedValue({})
		await new S3FileStorage("qsps-private", { send } as never).delete(
			"form-uploads/pending/u1/a.pdf"
		)
		const command = send.mock.calls[0]?.[0] as DeleteObjectCommand
		expect(command).toBeInstanceOf(DeleteObjectCommand)
		expect(command.input).toEqual({ Bucket: "qsps-private", Key: "form-uploads/pending/u1/a.pdf" })
	})

	it("lists every page under the prefix", async () => {
		const first = new Date("2026-11-20T00:00:00.000Z")
		const second = new Date("2026-11-23T00:00:00.000Z")
		const send = jest
			.fn()
			.mockResolvedValueOnce({
				Contents: [{ Key: "form-uploads/pending/u1/a.pdf", LastModified: first }],
				IsTruncated: true,
				NextContinuationToken: "page-2",
			})
			.mockResolvedValueOnce({
				Contents: [{ Key: "form-uploads/pending/u2/b.png", LastModified: second }],
				IsTruncated: false,
			})

		const files = await new S3FileStorage("qsps-private", { send } as never).list(
			"form-uploads/pending/"
		)

		expect(files).toEqual([
			{ key: "form-uploads/pending/u1/a.pdf", lastModified: first },
			{ key: "form-uploads/pending/u2/b.png", lastModified: second },
		])
		expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ListObjectsV2Command)
		expect((send.mock.calls[0]?.[0] as ListObjectsV2Command).input).toEqual({
			Bucket: "qsps-private",
			Prefix: "form-uploads/pending/",
			ContinuationToken: undefined,
		})
		expect((send.mock.calls[1]?.[0] as ListObjectsV2Command).input.ContinuationToken).toBe("page-2")
	})
})
