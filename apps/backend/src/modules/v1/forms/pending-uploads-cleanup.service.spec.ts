import { Logger } from "@nestjs/common"

import type { FileStorage, StoredFile } from "@/common/storage/file-storage"

import { confirmedKeyOf, isPendingUploadKey, uploadOwnerOf } from "./pending-uploads"
import { PendingUploadsCleanupService } from "./pending-uploads-cleanup.service"

const NOW = new Date("2026-11-24T19:00:00.000Z")
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000)

function fakeStorage(files: StoredFile[]) {
	return {
		put: jest.fn(),
		exists: jest.fn(),
		read: jest.fn(),
		copy: jest.fn(),
		list: jest.fn().mockResolvedValue(files),
		delete: jest.fn().mockResolvedValue(undefined),
	}
}

describe("pending upload keys", () => {
	it("tells pending and confirmed keys apart and finds the owner", () => {
		expect(isPendingUploadKey("form-uploads/pending/u1/a.pdf")).toBe(true)
		expect(isPendingUploadKey("form-uploads/u1/a.pdf")).toBe(false)
		expect(confirmedKeyOf("form-uploads/pending/u1/a.pdf")).toBe("form-uploads/u1/a.pdf")
		expect(() => confirmedKeyOf("form-uploads/u1/a.pdf")).toThrow()
		expect(uploadOwnerOf("form-uploads/pending/u1/a.pdf")).toBe("u1")
		expect(uploadOwnerOf("form-uploads/u1/a.pdf")).toBe("u1")
		// A user called "pending" does not own everyone's pending files.
		expect(uploadOwnerOf("form-uploads/pending/u1/a.pdf")).not.toBe("pending")
		expect(uploadOwnerOf("other/u1/a.pdf")).toBeNull()
	})
})

describe("PendingUploadsCleanupService", () => {
	let errors: jest.SpyInstance
	let warnings: jest.SpyInstance

	beforeEach(() => {
		jest.restoreAllMocks()
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined)
		warnings = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
		errors = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined)
	})

	it("deletes pending uploads older than 24 hours and keeps newer ones", async () => {
		const storage = fakeStorage([
			{ key: "form-uploads/pending/u1/old.pdf", lastModified: hoursAgo(25) },
			{ key: "form-uploads/pending/u2/new.png", lastModified: hoursAgo(23) },
		])
		const service = new PendingUploadsCleanupService(storage as unknown as FileStorage)

		await expect(service.sweep(NOW)).resolves.toBe(1)

		expect(storage.list).toHaveBeenCalledWith("form-uploads/pending/")
		expect(storage.delete).toHaveBeenCalledTimes(1)
		expect(storage.delete).toHaveBeenCalledWith("form-uploads/pending/u1/old.pdf")
	})

	it("keeps going when one delete fails", async () => {
		const storage = fakeStorage([
			{ key: "form-uploads/pending/u1/a.pdf", lastModified: hoursAgo(30) },
			{ key: "form-uploads/pending/u1/b.pdf", lastModified: hoursAgo(30) },
		])
		storage.delete.mockRejectedValueOnce(new Error("busy"))
		const service = new PendingUploadsCleanupService(storage as unknown as FileStorage)

		await expect(service.sweep(NOW)).resolves.toBe(1)
		expect(storage.delete).toHaveBeenCalledTimes(2)
		expect(warnings).toHaveBeenCalledWith(
			expect.objectContaining({ event: "forms.pending_uploads.delete_failed" })
		)
	})

	it("logs instead of throwing when the storage cannot be listed", async () => {
		const storage = fakeStorage([])
		storage.list.mockRejectedValue(new Error("access denied"))
		const service = new PendingUploadsCleanupService(storage as unknown as FileStorage)

		await expect(service.run()).resolves.toBeUndefined()
		expect(errors).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "forms.pending_uploads.sweep_failed",
				error: "access denied",
			})
		)
	})
})
