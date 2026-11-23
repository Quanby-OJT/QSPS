import type { AuditService } from "@/common/audit/audit.service"
import type { FileStorage } from "@/common/storage/file-storage"

import { FormUploadService } from "./form-uploads.service"

// Only the upload constants are needed; the barrel would load the ESM-only @orpc/contract.
jest.mock("@repo/contracts", () =>
	jest.requireActual("../../../../../../packages/contracts/src/modules/v1/forms/form-answers")
)
jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {},
}))

const UUID = "6adcc1a9-cbb0-4ce5-a2f0-9c07e5149fa8"
const PENDING = `form-uploads/pending/user_1/${UUID}.pdf`
const CONFIRMED = `form-uploads/user_1/${UUID}.pdf`
const OTHERS_PENDING = `form-uploads/pending/user_2/${UUID}.pdf`
/** Stands in for the booking transaction. */
const TX = { tx: true } as never

/** A storage that holds `stored`, where a copy really adds the new key. */
function setup(stored: string[]) {
	const files = new Set(stored)
	const storage = {
		put: jest.fn(),
		read: jest.fn(),
		list: jest.fn(),
		delete: jest.fn(),
		exists: jest.fn(async (key: string) => files.has(key)),
		copy: jest.fn(async (_from: string, to: string) => {
			files.add(to)
		}),
	}
	const audit = { record: jest.fn().mockResolvedValue(undefined) }
	const service = new FormUploadService(
		storage as unknown as FileStorage,
		audit as unknown as AuditService
	)
	return { storage, audit, service }
}

describe("FormUploadService pending uploads (FRM-2b)", () => {
	it("accepts the caller's own pending and confirmed uploads only", async () => {
		const { service } = setup([PENDING, CONFIRMED, OTHERS_PENDING])

		await expect(service.ownsUpload(PENDING, "user_1")).resolves.toBe(true)
		await expect(service.ownsUpload(CONFIRMED, "user_1")).resolves.toBe(true)
		await expect(service.ownsUpload(OTHERS_PENDING, "user_1")).resolves.toBe(false)
		// A user whose id is "pending" cannot claim other people's pending files.
		await expect(service.ownsUpload(PENDING, "pending")).resolves.toBe(false)
		await expect(
			service.ownsUpload(`form-uploads/pending/user_1/${UUID}.exe`, "user_1")
		).resolves.toBe(false)
	})

	it("refuses a pending upload that is no longer stored", async () => {
		const { service } = setup([])
		await expect(service.ownsUpload(PENDING, "user_1")).resolves.toBe(false)
	})

	it("copies a pending upload to the confirmed folder once, and audits it", async () => {
		const { service, storage, audit } = setup([PENDING])

		await expect(service.confirmUpload(PENDING, "user_1", TX)).resolves.toBe(CONFIRMED)
		// Saving the same answers again reuses the copy.
		await expect(service.confirmUpload(PENDING, "user_1", TX)).resolves.toBe(CONFIRMED)

		expect(storage.copy).toHaveBeenCalledTimes(1)
		expect(storage.copy).toHaveBeenCalledWith(PENDING, CONFIRMED)
		expect(audit.record).toHaveBeenCalledTimes(1)
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "form_upload.confirm",
				actorId: "user_1",
				targetId: CONFIRMED,
				oldValue: { fileKey: PENDING },
				newValue: { fileKey: CONFIRMED },
			}),
			TX
		)
	})

	it("returns a key that is already confirmed as it is", async () => {
		const { service, storage, audit } = setup([CONFIRMED])

		await expect(service.confirmUpload(CONFIRMED, "user_1", TX)).resolves.toBe(CONFIRMED)
		expect(storage.copy).not.toHaveBeenCalled()
		expect(audit.record).not.toHaveBeenCalled()
	})
})
