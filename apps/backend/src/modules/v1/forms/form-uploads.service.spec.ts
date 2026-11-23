import type { AuditService } from "@/common/audit/audit.service"
import type { FileStorage } from "@/common/storage/file-storage"

import { FormUploadService } from "./form-uploads.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options: { message: string }
		) {
			super(options.message)
		}
	},
}))

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])

function setup() {
	const storage: jest.Mocked<FileStorage> = {
		copy: jest.fn(),
		delete: jest.fn(),
		list: jest.fn(),
		put: jest.fn().mockResolvedValue(undefined),
		exists: jest.fn().mockResolvedValue(true),
		read: jest.fn(),
	}
	const audit = { record: jest.fn().mockResolvedValue(undefined) }
	const service = new FormUploadService(storage, audit as unknown as AuditService)
	return { storage, audit, service }
}

describe("FormUploadService.upload", () => {
	it("stores a PDF under the caller's folder and audits it without the content", async () => {
		const { storage, audit, service } = setup()
		const file = new File([PDF_BYTES], "C:\\Users\\me\\passport.pdf", { type: "application/pdf" })

		const result = await service.upload(file, "user_1")

		expect(result.fileKey).toMatch(/^form-uploads\/pending\/user_1\/[0-9a-f-]{36}\.pdf$/)
		expect(result).toMatchObject({
			fileName: "passport.pdf",
			contentType: "application/pdf",
			sizeBytes: PDF_BYTES.length,
		})
		expect(storage.put).toHaveBeenCalledWith(result.fileKey, PDF_BYTES, "application/pdf")
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "form_upload.create",
				actorId: "user_1",
				targetId: result.fileKey,
				newValue: { contentType: "application/pdf", sizeBytes: PDF_BYTES.length },
			})
		)
	})

	it("refuses a file whose content does not match its declared type", async () => {
		const { storage, service } = setup()
		const fake = new File([new TextEncoder().encode("MZ not a pdf")], "x.pdf", {
			type: "application/pdf",
		})
		await expect(service.upload(fake, "user_1")).rejects.toThrow("not a real PDF, JPG or PNG")
		expect(storage.put).not.toHaveBeenCalled()
	})

	it("refuses a PNG sent as a PDF", async () => {
		const { service } = setup()
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		const file = new File([png], "x.pdf", { type: "application/pdf" })
		await expect(service.upload(file, "user_1")).rejects.toThrow("not a real PDF, JPG or PNG")
	})

	it("refuses an empty file and a missing session", async () => {
		const { service } = setup()
		const empty = new File([], "x.pdf", { type: "application/pdf" })
		await expect(service.upload(empty, "user_1")).rejects.toThrow("The file is empty")
		await expect(service.upload(empty, null)).rejects.toThrow("Sign in")
	})
})

describe("FormUploadService.ownsUpload", () => {
	const key = "form-uploads/user_1/0b6f7a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b.pdf"

	it("accepts the caller's own stored upload", async () => {
		const { service } = setup()
		expect(await service.ownsUpload(key, "user_1")).toBe(true)
	})

	it("refuses another user's upload without looking it up", async () => {
		const { storage, service } = setup()
		expect(await service.ownsUpload(key, "user_2")).toBe(false)
		expect(storage.exists).not.toHaveBeenCalled()
	})

	it("refuses a key that is not stored", async () => {
		const { storage, service } = setup()
		storage.exists.mockResolvedValue(false)
		expect(await service.ownsUpload(key, "user_1")).toBe(false)
	})
})
// The upload rules only; the full contracts barrel pulls in ESM-only oRPC.
jest.mock("@repo/contracts", () =>
	jest.requireActual("../../../../../../packages/contracts/src/modules/v1/forms/form-answers")
)
