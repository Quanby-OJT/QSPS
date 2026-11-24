import { userRoles, users } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

import type { BookingService } from "../bookings/bookings.service"
import { mobileKey, WalkInService } from "./walk-in.service"

const mockRequestPasswordReset = jest.fn().mockResolvedValue({ status: true })

jest.mock("@repo/auth", () => ({
	authEnv: { APP_WEB_URL: "http://localhost:3001" },
	getAuth: () => ({ api: { requestPasswordReset: mockRequestPasswordReset } }),
}))

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			public readonly options: { message: string; data?: unknown }
		) {
			super(options.message)
		}
	},
}))

jest.mock("@/common/database/database.client", () => ({
	db: { select: jest.fn(), transaction: jest.fn() },
}))

// Passed in by hand below; mocked so the booking module's dependencies are not loaded.
jest.mock("../bookings/bookings.service", () => ({ BookingService: jest.fn() }))

/** A query that resolves to `rows` however it is chained. */
function query(rows: unknown[]) {
	const chain: Record<string, unknown> = {
		from: () => chain,
		innerJoin: () => chain,
		where: () => chain,
		orderBy: () => chain,
		for: () => Promise.resolve(rows),
		limit: () => Promise.resolve(rows),
		then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
			Promise.resolve(rows).then(resolve, reject),
	}
	return chain
}

/** db.select answers these row sets in order. */
function selects(...rowSets: unknown[][]) {
	const select = jest.mocked(db.select)
	select.mockReset()
	for (const rows of rowSets) select.mockReturnValueOnce(query(rows) as never)
}

/** Tuesday 24 November 2026, 15:00 in Manila. */
const NOW = new Date("2026-11-24T07:00:00.000Z")
const MANILA = { id: 2, name: "Manila" }
const MANILA_SCOPE = { nationwide: false, entries: [{ serviceCategoryId: 1, locationId: 2 }] }

const clientRow = {
	id: "client-1",
	name: "Juan Dela Cruz",
	email: "juan@example.com",
	mobile: "09171234567",
	birthDate: "1990-02-01",
	nationality: "Filipino",
	gender: "Male",
	mustResetPassword: true,
	accountType: "client",
}

const newClient = {
	name: "Juan Dela Cruz",
	email: "juan@example.com",
	mobile: "09171234567",
	birthDate: "1990-02-01",
	nationality: "Filipino",
	gender: "Male",
	privacyNoticeVersion: "2026-11-16" as const,
}

/**
 * A transaction: selects answer in order; inserts and updates are recorded.
 * An update returns `updateBase` with the new values.
 */
function mockTransaction(...rowSets: unknown[][]) {
	const inserts: { table: unknown; values: unknown }[] = []
	const updates: { table: unknown; values: unknown }[] = []
	let updateBase: object = clientRow
	const select = jest.fn()
	for (const rows of rowSets) select.mockReturnValueOnce(query(rows))
	const tx = {
		select,
		insert: jest.fn((table: unknown) => ({
			values: (values: unknown) => {
				inserts.push({ table, values })
				const returned = Promise.resolve([{ ...clientRow, ...(values as object) }])
				return { returning: () => returned, then: returned.then.bind(returned) }
			},
		})),
		update: jest.fn((table: unknown) => ({
			set: (values: unknown) => {
				updates.push({ table, values })
				return {
					where: () => ({
						returning: () => Promise.resolve([{ ...updateBase, ...(values as object) }]),
					}),
				}
			},
		})),
	}
	jest.mocked(db.transaction).mockImplementation(callback => callback(tx as never) as never)
	return {
		tx,
		inserts,
		updates,
		setUpdateBase: (row: object) => {
			updateBase = row
		},
	}
}

describe("WalkInService (PRC-2)", () => {
	let service: WalkInService
	let audit: { record: jest.Mock }
	let bookingService: { create: jest.Mock }

	beforeEach(() => {
		jest.clearAllMocks()
		audit = { record: jest.fn().mockResolvedValue(undefined) }
		bookingService = { create: jest.fn().mockResolvedValue({ id: 31, kind: "walk-in" }) }
		service = new WalkInService(
			bookingService as unknown as BookingService,
			audit as unknown as AuditService
		)
	})

	describe("mobileKey", () => {
		it("matches local and international forms of the same number", () => {
			expect(mobileKey("0917 123 4567")).toBe("9171234567")
			expect(mobileKey("+63-917-123-4567")).toBe("9171234567")
			expect(mobileKey("12345")).toBeNull()
		})
	})

	describe("lookup", () => {
		it("finds a client by email or mobile and says whether the invitation is pending", async () => {
			selects([clientRow])
			await expect(service.lookup("Juan@Example.com")).resolves.toEqual([
				{
					id: "client-1",
					name: "Juan Dela Cruz",
					email: "juan@example.com",
					mobile: "09171234567",
					birthDate: "1990-02-01",
					nationality: "Filipino",
					gender: "Male",
					invitationPending: true,
				},
			])

			selects([clientRow])
			await expect(service.lookup("+639171234567")).resolves.toHaveLength(1)
		})

		it("does not search with too few digits", async () => {
			selects()
			await expect(service.lookup("12345")).resolves.toEqual([])
			expect(db.select).not.toHaveBeenCalled()
		})
	})

	describe("createClient", () => {
		it("creates a client account with no password, flagged to set one, and invites them", async () => {
			const { tx, inserts } = mockTransaction([], [{ id: 3 }])

			const client = await service.createClient(newClient, "officer-7", NOW)

			expect(inserts.map(insert => insert.table)).toEqual([users, userRoles])
			expect(inserts[0]?.values).toMatchObject({
				name: "Juan Dela Cruz",
				email: "juan@example.com",
				emailVerified: true,
				accountType: "client",
				mustResetPassword: true,
				mobile: "09171234567",
				birthDate: "1990-02-01",
				createdAt: NOW,
			})
			expect(inserts[0]?.values).not.toHaveProperty("password")
			const values = inserts[0]?.values as { id: string }
			expect(audit.record.mock.calls[0]?.[0]).toMatchObject({ targetId: values.id })
			expect(inserts[1]?.values).toEqual({ userId: expect.any(String), roleId: 3 })
			expect(audit.record).toHaveBeenCalledWith(
				{
					domain: "bookings",
					action: "walk_in.client.create",
					actorId: "officer-7",
					targetType: "user",
					targetId: expect.any(String),
					oldValue: null,
					newValue: {
						accountType: "client",
						mustResetPassword: true,
						roles: ["Client"],
						hasMobile: true,
						hasEmail: true,
						privacyNoticeVersion: "2026-11-16",
					},
				},
				tx
			)
			expect(mockRequestPasswordReset).toHaveBeenCalledWith({
				body: {
					email: "juan@example.com",
					redirectTo: "http://localhost:3001/reset-password",
				},
			})
			expect(client).toMatchObject({ email: "juan@example.com", invitationPending: true })
		})

		it("refuses a duplicate and names the existing client, creating nothing", async () => {
			const { inserts } = mockTransaction([
				{ id: "client-1", email: "juan@example.com", accountType: "client" },
			])

			await expect(service.createClient(newClient, "officer-7", NOW)).rejects.toMatchObject({
				code: "CONFLICT",
				options: expect.objectContaining({ data: { clientId: "client-1", matchedBy: "email" } }),
			})
			expect(inserts).toEqual([])
			expect(mockRequestPasswordReset).not.toHaveBeenCalled()
		})

		it("refuses a mobile number that belongs to another client", async () => {
			mockTransaction([{ id: "client-2", email: "other@example.com", accountType: "client" }])
			await expect(service.createClient(newClient, "officer-7", NOW)).rejects.toMatchObject({
				code: "CONFLICT",
				message: expect.stringContaining("mobile number"),
				options: expect.objectContaining({ data: { clientId: "client-2", matchedBy: "mobile" } }),
			})
		})

		it("never reveals a staff account's id", async () => {
			mockTransaction([{ id: "staff-1", email: "juan@example.com", accountType: "staff" }])
			await expect(service.createClient(newClient, "officer-7", NOW)).rejects.toMatchObject({
				code: "CONFLICT",
				options: expect.objectContaining({ data: {} }),
			})
		})

		it("keeps the account when the invitation cannot be sent", async () => {
			mockTransaction([], [{ id: 3 }])
			mockRequestPasswordReset.mockRejectedValueOnce(new Error("SMTP down"))
			await expect(service.createClient(newClient, "officer-7", NOW)).resolves.toMatchObject({
				email: "juan@example.com",
			})
		})

		it("saves the Privacy Notice version and time on the account, in the transaction (PRC-2b)", async () => {
			const { tx, inserts } = mockTransaction([], [{ id: 3 }])
			jest.mocked(db.transaction).mockImplementationOnce(callback => {
				// Everything is written through `tx`, never the shared connection.
				expect(db.select).not.toHaveBeenCalled()
				return callback(tx as never) as never
			})

			await service.createClient(newClient, "officer-7", NOW)

			expect(inserts[0]?.values).toMatchObject({
				privacyNoticeVersion: "2026-11-16",
				privacyAcceptedAt: NOW,
			})
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "walk_in.client.create",
					newValue: expect.objectContaining({ privacyNoticeVersion: "2026-11-16" }),
				}),
				tx
			)
		})

		it("audits no personal data", async () => {
			mockTransaction([], [{ id: 3 }])
			await service.createClient(newClient, "officer-7", NOW)
			const recorded = JSON.stringify(audit.record.mock.calls[0]?.[0])
			for (const personal of ["Juan", "juan@example.com", "09171234567", "1990-02-01"]) {
				expect(recorded).not.toContain(personal)
			}
		})

		describe("a mobile-only client (PRC-2b)", () => {
			const mobileOnly = { ...newClient, email: null }

			it("stores the placeholder <userId>@no-email.invalid and sends no email", async () => {
				const { tx, inserts } = mockTransaction([], [{ id: 3 }])

				const client = await service.createClient(mobileOnly, "officer-7", NOW)

				const values = inserts[0]?.values as { id: string; email: string }
				expect(values.email).toBe(`${values.id}@no-email.invalid`)
				expect(values).toMatchObject({ emailVerified: false, mustResetPassword: true })
				expect(mockRequestPasswordReset).not.toHaveBeenCalled()
				expect(audit.record).toHaveBeenCalledWith(
					expect.objectContaining({
						newValue: expect.objectContaining({ hasEmail: false, hasMobile: true }),
					}),
					tx
				)
				// Never shown as an email.
				expect(client.email).toBeNull()
				expect(JSON.stringify(client)).not.toContain("no-email.invalid")
			})

			it("checks duplicates by mobile only", async () => {
				mockTransaction([{ id: "client-2", email: "x@no-email.invalid", accountType: "client" }])
				await expect(service.createClient(mobileOnly, "officer-7", NOW)).rejects.toMatchObject({
					code: "CONFLICT",
					options: expect.objectContaining({ data: { clientId: "client-2", matchedBy: "mobile" } }),
				})
			})

			it("is refused with neither an email nor a mobile number", async () => {
				await expect(
					service.createClient({ ...mobileOnly, mobile: null }, "officer-7", NOW)
				).rejects.toMatchObject({ code: "BAD_REQUEST" })
				expect(db.transaction).not.toHaveBeenCalled()
			})
		})
	})

	describe("lookup of a placeholder (PRC-2b)", () => {
		it("finds no one by the placeholder address", async () => {
			selects()
			await expect(service.lookup("client-1@no-email.invalid")).resolves.toEqual([])
			expect(db.select).not.toHaveBeenCalled()
		})

		it("shows a mobile-only client with no email", async () => {
			selects([{ ...clientRow, email: "client-1@no-email.invalid" }])
			const [found] = await service.lookup("09171234567")
			expect(found?.email).toBeNull()
		})
	})

	describe("addClientEmail (PRC-2b)", () => {
		const placeholderClient = { ...clientRow, email: "client-1@no-email.invalid" }
		const input = { clientId: "client-1", email: "Juan@Example.com" }

		it("replaces the placeholder with the real email and sends the invitation", async () => {
			const { tx, updates, setUpdateBase } = mockTransaction(
				[{ id: "client-1", email: "client-1@no-email.invalid" }],
				[]
			)
			setUpdateBase(placeholderClient)

			const client = await service.addClientEmail(input, "officer-7", NOW)

			expect(updates).toEqual([
				{
					table: users,
					values: { email: "juan@example.com", emailVerified: true, updatedAt: NOW },
				},
			])
			expect(audit.record).toHaveBeenCalledWith(
				{
					domain: "bookings",
					action: "walk_in.client.email_add",
					actorId: "officer-7",
					targetType: "user",
					targetId: "client-1",
					oldValue: { hasEmail: false },
					newValue: { hasEmail: true, invitationSent: true },
				},
				tx
			)
			expect(mockRequestPasswordReset).toHaveBeenCalledWith({
				body: {
					email: "juan@example.com",
					redirectTo: "http://localhost:3001/reset-password",
				},
			})
			expect(client).toMatchObject({ email: "juan@example.com", invitationPending: true })
		})

		it("sends no invitation to a client who already set a password", async () => {
			const { setUpdateBase } = mockTransaction(
				[{ id: "client-1", email: "client-1@no-email.invalid" }],
				[]
			)
			setUpdateBase({ ...placeholderClient, mustResetPassword: false })
			await service.addClientEmail(input, "officer-7", NOW)
			expect(mockRequestPasswordReset).not.toHaveBeenCalled()
		})

		it("does not change an email the client already has", async () => {
			const { updates } = mockTransaction([{ id: "client-1", email: "juan@example.com" }])
			await expect(service.addClientEmail(input, "officer-7", NOW)).rejects.toMatchObject({
				code: "CONFLICT",
			})
			expect(updates).toEqual([])
			expect(mockRequestPasswordReset).not.toHaveBeenCalled()
		})

		it("refuses an email another account has, naming a client but never staff", async () => {
			mockTransaction(
				[{ id: "client-1", email: "client-1@no-email.invalid" }],
				[{ id: "client-2", accountType: "client" }]
			)
			await expect(service.addClientEmail(input, "officer-7", NOW)).rejects.toMatchObject({
				code: "CONFLICT",
				options: expect.objectContaining({ data: { clientId: "client-2", matchedBy: "email" } }),
			})

			mockTransaction(
				[{ id: "client-1", email: "client-1@no-email.invalid" }],
				[{ id: "staff-1", accountType: "staff" }]
			)
			await expect(service.addClientEmail(input, "officer-7", NOW)).rejects.toMatchObject({
				code: "CONFLICT",
				options: expect.objectContaining({ data: {} }),
			})
		})

		it("answers 404 for an account that is not an active client", async () => {
			mockTransaction([])
			await expect(service.addClientEmail(input, "officer-7", NOW)).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
		})

		it("refuses another placeholder as the new address", async () => {
			await expect(
				service.addClientEmail({ clientId: "client-1", email: "x@no-email.invalid" }, "officer-7")
			).rejects.toMatchObject({ code: "BAD_REQUEST" })
		})
	})

	describe("slots", () => {
		it("is empty, with no location, for an officer who has no Location", async () => {
			selects([])
			await expect(service.slots(1, "officer-7", MANILA_SCOPE as never, NOW)).resolves.toEqual({
				location: null,
				date: "2026-11-24",
				slots: [],
			})
		})

		it("lists today's slots here that have not ended, with places left", async () => {
			selects(
				[MANILA],
				[{ serviceCategoryId: 1 }],
				[
					{
						id: 7,
						startsAt: new Date("2026-11-24T06:00:00.000Z"),
						endsAt: new Date("2026-11-24T10:00:00.000Z"),
						capacity: 20,
						bookedCount: 20,
					},
					{
						id: 8,
						startsAt: new Date("2026-11-24T08:00:00.000Z"),
						endsAt: new Date("2026-11-24T09:00:00.000Z"),
						capacity: 5,
						bookedCount: 2,
					},
				]
			)

			const result = await service.slots(1, "officer-7", MANILA_SCOPE as never, NOW)

			expect(result.location).toEqual(MANILA)
			expect(result.slots).toEqual([
				expect.objectContaining({ id: 7, remaining: 0, inProgress: true }),
				expect.objectContaining({ id: 8, remaining: 3, inProgress: false }),
			])
		})

		it("lists nothing for a Service outside the officer's Scope", async () => {
			selects([MANILA], [{ serviceCategoryId: 5 }])
			await expect(
				service.slots(1, "officer-7", MANILA_SCOPE as never, NOW)
			).resolves.toMatchObject({ slots: [] })
		})
	})

	describe("createBooking", () => {
		const input = {
			clientId: "client-1",
			items: [{ scheduleSlotId: 7 }],
			acceptedPolicyDocumentIds: [],
		}
		const todaySlot = {
			id: 7,
			locationId: 2,
			startsAt: new Date("2026-11-24T06:00:00.000Z"),
			serviceCategoryId: 1,
		}

		it("books the client through BookingService as a walk-in at the officer's Location", async () => {
			selects([MANILA], [{ id: "client-1" }], [todaySlot])

			await expect(
				service.createBooking(input, "officer-7", MANILA_SCOPE as never, NOW)
			).resolves.toMatchObject({ kind: "walk-in" })
			expect(bookingService.create).toHaveBeenCalledWith(input, "officer-7", NOW, {
				clientId: "client-1",
				locationId: 2,
			})
		})

		it("answers 404 and audits when the officer has no Location", async () => {
			selects([])
			await expect(
				service.createBooking(input, "officer-7", MANILA_SCOPE as never, NOW)
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "booking.walk_in.create",
					outcome: "denied",
					reason: "no_location",
				})
			)
			expect(bookingService.create).not.toHaveBeenCalled()
		})

		it("answers 404 and audits a slot at another Location", async () => {
			selects([MANILA], [{ id: "client-1" }], [{ ...todaySlot, locationId: 4 }])
			await expect(
				service.createBooking(input, "officer-7", MANILA_SCOPE as never, NOW)
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "booking.walk_in.create",
					outcome: "denied",
					targetType: "schedule_slot",
					targetId: "7",
					reason: "outside_scope",
				})
			)
			expect(bookingService.create).not.toHaveBeenCalled()
		})

		it("answers 404 and audits a Service outside the officer's Scope", async () => {
			selects([MANILA], [{ id: "client-1" }], [{ ...todaySlot, serviceCategoryId: 5 }])
			await expect(
				service.createBooking(input, "officer-7", MANILA_SCOPE as never, NOW)
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({ outcome: "denied", reason: "outside_scope" })
			)
		})

		it("books only into today's schedule", async () => {
			selects(
				[MANILA],
				[{ id: "client-1" }],
				[{ ...todaySlot, startsAt: new Date("2026-11-25T01:00:00.000Z") }]
			)
			await expect(
				service.createBooking(input, "officer-7", MANILA_SCOPE as never, NOW)
			).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("today") })
			expect(bookingService.create).not.toHaveBeenCalled()
		})

		it("answers 404 for a client that does not exist or is not a client", async () => {
			selects([MANILA], [])
			await expect(
				service.createBooking(input, "officer-7", MANILA_SCOPE as never, NOW)
			).rejects.toMatchObject({ code: "NOT_FOUND", message: "Client not found" })
			expect(bookingService.create).not.toHaveBeenCalled()
		})
	})
})
