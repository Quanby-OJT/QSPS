import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"

import { sniffContentType } from "./content-type"
import { assertStorageKey } from "./file-storage"
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
})
