import { Logger } from "@nestjs/common"

import { setAuthPolicyReader } from "@repo/auth/auth-policies"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { env } from "@/config/env.config"

import { PolicyService } from "./policy.service"

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

jest.mock("@/common/database/database.client", () => ({
	db: {
		select: jest.fn(),
		transaction: jest.fn(),
	},
}))

jest.mock("@/config/env.config", () => ({
	env: {
		BOOKING_HOLD_MINUTES: undefined,
		AUTH_LOCKOUT_THRESHOLD: undefined,
		AUTH_LOCKOUT_MINUTES: undefined,
		AUTH_STAFF_PASSWORD_MAX_AGE_DAYS: undefined,
	},
}))

jest.mock("@repo/auth/auth-policies", () => ({
	setAuthPolicyReader: jest.fn(),
}))

// @repo/contracts' index also loads every oRPC contract, and @orpc/contract is
// ESM-only, which Jest cannot load. PolicyService needs only the registry.
jest.mock("@repo/contracts", () =>
	jest.requireActual("../../../../../packages/contracts/src/modules/v1/policies/policies.registry")
)

const mutableEnv = env as unknown as Record<string, number | undefined>

/** A query that resolves to `rows` however it is chained. */
function query(rows: unknown[]) {
	const chain: Record<string, unknown> = {
		from: () => chain,
		leftJoin: () => chain,
		where: () => chain,
		then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
			Promise.resolve(rows).then(resolve, reject),
	}
	return chain
}

/** Minimal stand-in for the ioredis surface this service uses. */
function fakeRedis(overrides: Partial<Record<string, unknown>> = {}) {
	const store = new Map<string, string>()
	return {
		store,
		get: jest.fn(async (key: string) => store.get(key) ?? null),
		set: jest.fn(async (key: string, value: string) => {
			store.set(key, value)
			return "OK"
		}),
		del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
		...overrides,
	}
}

const UPDATED_AT = new Date("2026-11-21T06:00:00.000Z")

beforeAll(() => {
	jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {})
	jest.spyOn(Logger.prototype, "error").mockImplementation(() => {})
})

afterAll(() => {
	jest.restoreAllMocks()
})

describe("PolicyService.get", () => {
	let auditService: { record: jest.Mock }

	beforeEach(() => {
		jest.clearAllMocks()
		for (const key of Object.keys(mutableEnv)) mutableEnv[key] = undefined
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
	})

	it("answers with the documented default when nothing is stored", async () => {
		jest.mocked(db.select).mockReturnValue(query([]) as never)
		const service = new PolicyService(auditService as unknown as AuditService, null)

		await expect(service.get("booking.hold_minutes")).resolves.toBe(60)
		await expect(service.get("booking.expedite_enabled")).resolves.toBe(true)
		await expect(service.get("payment.forfeit_on_no_show")).resolves.toBe(false)
	})

	it("answers with the env value in place of the default when it is set", async () => {
		mutableEnv.AUTH_LOCKOUT_MINUTES = 2
		jest.mocked(db.select).mockReturnValue(query([]) as never)
		const service = new PolicyService(auditService as unknown as AuditService, null)

		await expect(service.get("auth.lockout_minutes")).resolves.toBe(2)
	})

	it("ignores an env value outside the key's range", async () => {
		mutableEnv.BOOKING_HOLD_MINUTES = 1
		jest.mocked(db.select).mockReturnValue(query([]) as never)
		const service = new PolicyService(auditService as unknown as AuditService, null)

		await expect(service.get("booking.hold_minutes")).resolves.toBe(60)
	})

	it("answers with the stored value over the default and the env value", async () => {
		mutableEnv.BOOKING_HOLD_MINUTES = 45
		jest
			.mocked(db.select)
			.mockReturnValue(query([{ key: "booking.hold_minutes", value: 90 }]) as never)
		const service = new PolicyService(auditService as unknown as AuditService, null)

		await expect(service.get("booking.hold_minutes")).resolves.toBe(90)
	})

	it("falls back to the default when a stored value no longer passes its rule", async () => {
		jest
			.mocked(db.select)
			.mockReturnValue(query([{ key: "booking.hold_minutes", value: 99999 }]) as never)
		const service = new PolicyService(auditService as unknown as AuditService, null)

		await expect(service.get("booking.hold_minutes")).resolves.toBe(60)
	})

	it("reads from the cache without touching the database", async () => {
		const redis = fakeRedis()
		redis.store.set("policy:values", JSON.stringify({ "booking.hold_minutes": 30 }))
		const service = new PolicyService(auditService as unknown as AuditService, redis as never)

		await expect(service.get("booking.hold_minutes")).resolves.toBe(30)
		expect(db.select).not.toHaveBeenCalled()
	})

	it("fills the cache on a miss, with a TTL", async () => {
		const redis = fakeRedis()
		jest
			.mocked(db.select)
			.mockReturnValue(query([{ key: "booking.hold_minutes", value: 90 }]) as never)
		const service = new PolicyService(auditService as unknown as AuditService, redis as never)

		await service.get("booking.hold_minutes")

		expect(redis.set).toHaveBeenCalledWith(
			"policy:values",
			JSON.stringify({ "booking.hold_minutes": 90 }),
			"EX",
			60
		)
	})

	it("goes to the database when Redis fails", async () => {
		const redis = fakeRedis({ get: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) })
		jest
			.mocked(db.select)
			.mockReturnValue(query([{ key: "booking.hold_minutes", value: 90 }]) as never)
		const service = new PolicyService(auditService as unknown as AuditService, redis as never)

		await expect(service.get("booking.hold_minutes")).resolves.toBe(90)
	})
})

describe("PolicyService.set", () => {
	let auditService: { record: jest.Mock }

	/** A transaction that records the lock, the stored row it reads, the upsert and its values. */
	function mockSetTransaction(currentRows: unknown[]) {
		const execute = jest.fn().mockResolvedValue(undefined)
		const values = jest.fn()
		const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined)
		const tx = {
			execute,
			select: jest.fn().mockReturnValue(query(currentRows)),
			insert: jest.fn().mockReturnValue({
				values: (row: unknown) => {
					values(row)
					return { onConflictDoUpdate }
				},
			}),
		}
		jest.mocked(db.transaction).mockImplementation(callback => callback(tx as never) as never)
		return { tx, execute, values, onConflictDoUpdate }
	}

	beforeEach(() => {
		jest.clearAllMocks()
		for (const key of Object.keys(mutableEnv)) mutableEnv[key] = undefined
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
	})

	it("stores the value, audits key, old and new value and actor in the same transaction", async () => {
		const { tx, execute, values, onConflictDoUpdate } = mockSetTransaction([{ value: 60 }])
		jest.mocked(db.select).mockReturnValue(
			query([
				{
					key: "booking.hold_minutes",
					value: 90,
					updatedAt: UPDATED_AT,
					updatedByEmail: "admin@qsps.local",
				},
			]) as never
		)
		const service = new PolicyService(auditService as unknown as AuditService, null)

		const policy = await service.set("booking.hold_minutes", 90, "admin-1")

		expect(execute).toHaveBeenCalledTimes(1)
		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({ key: "booking.hold_minutes", value: 90, updatedBy: "admin-1" })
		)
		expect(onConflictDoUpdate).toHaveBeenCalledWith(
			expect.objectContaining({ set: expect.objectContaining({ value: 90, updatedBy: "admin-1" }) })
		)
		expect(auditService.record).toHaveBeenCalledWith(
			{
				domain: "settings",
				action: "policy.update",
				actorId: "admin-1",
				targetType: "policy",
				targetId: "booking.hold_minutes",
				oldValue: { value: 60, isDefault: false },
				newValue: { value: 90 },
			},
			tx
		)
		expect(policy).toMatchObject({
			key: "booking.hold_minutes",
			value: 90,
			isDefault: false,
			updatedByEmail: "admin@qsps.local",
		})
	})

	it("records the default as the old value when nothing was stored", async () => {
		mutableEnv.AUTH_LOCKOUT_MINUTES = 2
		mockSetTransaction([])
		jest.mocked(db.select).mockReturnValue(query([]) as never)
		const service = new PolicyService(auditService as unknown as AuditService, null)

		await service.set("auth.lockout_minutes", 30, "admin-1")

		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				oldValue: { value: 2, isDefault: true },
				newValue: { value: 30 },
			}),
			expect.anything()
		)
	})

	it("stores a help desk channel trimmed", async () => {
		const { values } = mockSetTransaction([])
		jest.mocked(db.select).mockReturnValue(query([]) as never)
		const service = new PolicyService(auditService as unknown as AuditService, null)

		await service.set("support.email", "  help@example.gov.ph ", "admin-1")

		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({ key: "support.email", value: "help@example.gov.ph" })
		)
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				targetId: "support.email",
				oldValue: { value: "", isDefault: true },
				newValue: { value: "help@example.gov.ph" },
			}),
			expect.anything()
		)
	})

	it.each([
		["support.ticket_url", "http://help.example.gov.ph"],
		["support.phone", "call us"],
		["booking.hold_minutes", 4],
		["booking.hold_minutes", 30.5],
		["booking.expedite_enabled", 1],
		["auth.lockout_threshold", 0],
	] as const)("refuses %s = %s before opening a transaction", async (key, value) => {
		const service = new PolicyService(auditService as unknown as AuditService, null)

		await expect(service.set(key, value, "admin-1")).rejects.toMatchObject({ code: "BAD_REQUEST" })
		expect(db.transaction).not.toHaveBeenCalled()
		expect(auditService.record).not.toHaveBeenCalled()
	})

	it("refuses a change with no signed-in user", async () => {
		const service = new PolicyService(auditService as unknown as AuditService, null)

		await expect(service.set("booking.hold_minutes", 90, null)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		})
		expect(db.transaction).not.toHaveBeenCalled()
	})

	it("clears the cache once the change has committed", async () => {
		const redis = fakeRedis()
		redis.store.set("policy:values", JSON.stringify({ "booking.hold_minutes": 60 }))
		mockSetTransaction([{ value: 60 }])
		jest.mocked(db.select).mockReturnValue(query([]) as never)
		const service = new PolicyService(auditService as unknown as AuditService, redis as never)

		await service.set("booking.hold_minutes", 90, "admin-1")

		expect(redis.del).toHaveBeenCalledWith("policy:values")
		expect(redis.store.has("policy:values")).toBe(false)
	})

	it("still succeeds when the cache cannot be cleared, since the change is stored", async () => {
		const redis = fakeRedis({ del: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) })
		mockSetTransaction([{ value: 60 }])
		jest
			.mocked(db.select)
			.mockReturnValue(
				query([
					{ key: "booking.hold_minutes", value: 90, updatedAt: UPDATED_AT, updatedByEmail: null },
				]) as never
			)
		const service = new PolicyService(auditService as unknown as AuditService, redis as never)

		await expect(service.set("booking.hold_minutes", 90, "admin-1")).resolves.toMatchObject({
			value: 90,
		})
	})
})

describe("PolicyService.list", () => {
	beforeEach(() => {
		jest.clearAllMocks()
		for (const key of Object.keys(mutableEnv)) mutableEnv[key] = undefined
	})

	it("lists every registered key, stored or not, with its rule and default", async () => {
		mutableEnv.AUTH_LOCKOUT_MINUTES = 2
		jest.mocked(db.select).mockReturnValue(
			query([
				{
					key: "booking.hold_minutes",
					value: 90,
					updatedAt: UPDATED_AT,
					updatedByEmail: "admin@qsps.local",
				},
			]) as never
		)
		const service = new PolicyService({ record: jest.fn() } as unknown as AuditService, null)

		const list = await service.list()

		expect(list).toHaveLength(18)
		expect(list.find(policy => policy.key === "booking.hold_minutes")).toEqual({
			key: "booking.hold_minutes",
			area: "booking",
			label: "Unpaid booking hold",
			description: expect.any(String),
			type: "integer",
			min: 5,
			max: 1440,
			unit: "minutes",
			format: null,
			maxLength: null,
			defaultValue: 60,
			value: 90,
			isDefault: false,
			updatedAt: UPDATED_AT,
			updatedByEmail: "admin@qsps.local",
		})
		expect(list.find(policy => policy.key === "auth.lockout_minutes")).toMatchObject({
			defaultValue: 2,
			value: 2,
			isDefault: true,
			updatedAt: null,
		})
		expect(list.find(policy => policy.key === "booking.expedite_enabled")).toMatchObject({
			type: "boolean",
			min: null,
			max: null,
			unit: null,
			value: true,
		})
		expect(list.find(policy => policy.key === "support.ticket_url")).toMatchObject({
			area: "support",
			type: "text",
			format: "url",
			maxLength: 500,
			min: null,
			unit: null,
			defaultValue: "",
			value: "",
			isDefault: true,
		})
	})
})

describe("PolicyService.supportContacts (ADM-8)", () => {
	beforeEach(() => {
		jest.clearAllMocks()
		for (const key of Object.keys(mutableEnv)) mutableEnv[key] = undefined
	})

	it("answers with every channel null when none is set", async () => {
		jest.mocked(db.select).mockReturnValue(query([]) as never)
		const service = new PolicyService({ record: jest.fn() } as unknown as AuditService, null)

		await expect(service.supportContacts()).resolves.toEqual({
			phone: null,
			email: null,
			ticketUrl: null,
			hours: null,
		})
	})

	it("answers with the set channels and leaves blank ones null", async () => {
		jest.mocked(db.select).mockReturnValue(
			query([
				{ key: "support.phone", value: "+63 2 8123 4567" },
				{ key: "support.email", value: "" },
				{ key: "support.ticket_url", value: "https://help.example.gov.ph" },
			]) as never
		)
		const service = new PolicyService({ record: jest.fn() } as unknown as AuditService, null)

		await expect(service.supportContacts()).resolves.toEqual({
			phone: "+63 2 8123 4567",
			email: null,
			ticketUrl: "https://help.example.gov.ph",
			hours: null,
		})
	})

	it("hides a stored value that no longer passes its rule", async () => {
		jest
			.mocked(db.select)
			.mockReturnValue(query([{ key: "support.ticket_url", value: "not a link" }]) as never)
		const service = new PolicyService({ record: jest.fn() } as unknown as AuditService, null)

		await expect(service.supportContacts()).resolves.toMatchObject({ ticketUrl: null })
	})

	it("reads from the cache, so a cleared cache shows a change on the next read", async () => {
		const redis = fakeRedis()
		redis.store.set(
			"policy:values",
			JSON.stringify({ "support.hours": "Mon to Fri, 8 AM to 5 PM" })
		)
		const service = new PolicyService(
			{ record: jest.fn() } as unknown as AuditService,
			redis as never
		)

		await expect(service.supportContacts()).resolves.toMatchObject({
			hours: "Mon to Fri, 8 AM to 5 PM",
		})
		expect(db.select).not.toHaveBeenCalled()
	})
})

describe("AUTH-3 reader", () => {
	beforeEach(() => {
		jest.clearAllMocks()
		for (const key of Object.keys(mutableEnv)) mutableEnv[key] = undefined
	})

	it("registers on startup and unregisters on shutdown", () => {
		const service = new PolicyService({ record: jest.fn() } as unknown as AuditService, null)

		service.onModuleInit()
		expect(setAuthPolicyReader).toHaveBeenCalledWith(expect.any(Function))

		service.onModuleDestroy()
		expect(setAuthPolicyReader).toHaveBeenLastCalledWith(null)
	})

	it("hands sign-in the stored lockout and rotation values", async () => {
		jest.mocked(db.select).mockReturnValue(
			query([
				{ key: "auth.lockout_threshold", value: 3 },
				{ key: "auth.staff_password_max_age_days", value: 60 },
			]) as never
		)
		const service = new PolicyService({ record: jest.fn() } as unknown as AuditService, null)

		await expect(service.authPolicies()).resolves.toEqual({
			lockoutThreshold: 3,
			lockoutMinutes: 15,
			staffPasswordMaxAgeDays: 60,
		})
	})
})
