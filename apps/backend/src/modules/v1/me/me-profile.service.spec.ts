import { users } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

import { MeProfileService } from "./me-profile.service"

// Backend Jest cannot load @repo/contracts' runtime exports; the helper is
// tested with the real implementation in @repo/contracts.
jest.mock("@repo/contracts", () => ({
	PRIVACY_NOTICE_VERSION: "2026-11-16",
	privacyConsentRequired: (accepted: string | null | undefined, current: string) =>
		!accepted || accepted < current,
}))

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			public readonly options: { message: string }
		) {
			super(options.message)
		}
	},
}))

jest.mock("@/common/database/database.client", () => ({
	db: { select: jest.fn(), transaction: jest.fn() },
}))

const NOW = new Date("2026-11-24T07:00:00.000Z")

const profileRow = {
	name: "Juan Dela Cruz",
	email: "juan@example.com",
	mobile: "09171234567",
	birthDate: "1990-02-01",
	nationality: "Filipino",
	gender: "Male",
	profileCompletedAt: NOW,
	privacyNoticeVersion: "2026-11-16" as string | null,
}

/** A query that resolves to `rows` however it is chained. */
function query(rows: unknown[]) {
	const chain: Record<string, unknown> = {
		from: () => chain,
		where: () => chain,
		for: () => Promise.resolve(rows),
		then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
			Promise.resolve(rows).then(resolve, reject),
	}
	return chain
}

describe("MeProfileService Privacy Notice consent (PRC-2b)", () => {
	let service: MeProfileService
	let audit: { record: jest.Mock }

	beforeEach(() => {
		jest.clearAllMocks()
		audit = { record: jest.fn().mockResolvedValue(undefined) }
		service = new MeProfileService(audit as unknown as AuditService)
	})

	describe("getProfile: whether to ask at sign-in", () => {
		it.each([
			["no consent on record", null, true],
			["an older notice than the current one", "2026-01-01", true],
			["the current notice", "2026-11-16", false],
		])("with %s, asks: %s", async (_label, privacyNoticeVersion, required) => {
			jest
				.mocked(db.select)
				.mockReturnValueOnce(query([{ ...profileRow, privacyNoticeVersion }]) as never)
			const profile = await service.getProfile("user-1")
			expect(profile.privacyConsentRequired).toBe(required)
			expect(profile).not.toHaveProperty("privacyNoticeVersion")
		})

		it("never shows a placeholder as the email", async () => {
			jest
				.mocked(db.select)
				.mockReturnValueOnce(query([{ ...profileRow, email: "user-1@no-email.invalid" }]) as never)
			await expect(service.getProfile("user-1")).resolves.toMatchObject({ email: null })
		})
	})

	describe("acceptPrivacyNotice", () => {
		function mockTransaction(current: unknown[]) {
			const updates: unknown[] = []
			const tx = {
				select: jest.fn(() => query(current)),
				update: jest.fn((table: unknown) => ({
					set: (values: object) => {
						updates.push({ table, values })
						return {
							where: () => ({
								returning: () => Promise.resolve([{ ...profileRow, ...values }]),
							}),
						}
					},
				})),
			}
			jest.mocked(db.transaction).mockImplementation(callback => callback(tx as never) as never)
			return { tx, updates }
		}

		it("saves the current version and time, and audits the versions on tx", async () => {
			const { tx, updates } = mockTransaction([{ privacyNoticeVersion: "2026-01-01" }])

			const profile = await service.acceptPrivacyNotice(
				"user-1",
				{ privacyNoticeVersion: "2026-11-16" },
				NOW
			)

			expect(updates).toEqual([
				{
					table: users,
					values: { privacyNoticeVersion: "2026-11-16", privacyAcceptedAt: NOW, updatedAt: NOW },
				},
			])
			expect(audit.record).toHaveBeenCalledWith(
				{
					domain: "account",
					action: "privacy_notice.accept",
					actorId: "user-1",
					targetType: "user",
					targetId: "user-1",
					oldValue: { privacyNoticeVersion: "2026-01-01" },
					newValue: { privacyNoticeVersion: "2026-11-16" },
				},
				tx
			)
			expect(profile.privacyConsentRequired).toBe(false)
		})

		it("refuses a version that is not the current one", async () => {
			await expect(
				service.acceptPrivacyNotice("user-1", { privacyNoticeVersion: "2020-01-01" } as never)
			).rejects.toMatchObject({ code: "BAD_REQUEST" })
			expect(db.transaction).not.toHaveBeenCalled()
		})

		it("answers 404 for an account that does not exist", async () => {
			mockTransaction([])
			await expect(
				service.acceptPrivacyNotice("user-1", { privacyNoticeVersion: "2026-11-16" })
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(audit.record).not.toHaveBeenCalled()
		})
	})
})
