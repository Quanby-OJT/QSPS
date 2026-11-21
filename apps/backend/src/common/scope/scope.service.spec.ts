import { ORPCError } from "@orpc/server"

import type { ResolvedPermissionSet } from "@/common/rbac/rbac-cache.service"

// @orpc/server and the real services load ESM-only packages that Jest's
// CommonJS runtime cannot read, so stand-ins are used. ScopeService only
// needs the error class, the audit domain name and the two injected services.
jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message)
		}
	},
}))
jest.mock("@/common/audit/audit.service", () => ({ AUDIT_DOMAIN_RBAC: "rbac", AuditService: class {} }))
jest.mock("@/common/rbac/rbac.service", () => ({ RbacService: class {} }))
// The contracts package's entry point loads @orpc/contract (ESM only). Only the
// nationwide role list is needed here, so it is copied from rbac.catalog.ts.
jest.mock("@repo/contracts", () => ({
	NATIONWIDE_ROLES: ["Super Admin", "System Admin", "Auditor"],
}))

import { inScope, scopeCondition, scopeContains, toResolvedScope } from "./scope-match"
import { ScopeService } from "./scope.service"

const IMMUNIZATION = 1
const PORT_HEALTH = 2
const CEBU = 10
const MANILA = 20

function access(roles: string[], scopes: ResolvedPermissionSet["scopes"]): ResolvedPermissionSet {
	return { roleNames: new Set(roles), permissionNames: new Set(), scopes }
}

const cebuImmunization = toResolvedScope(
	access(["Processing Officer"], [{ serviceCategoryId: IMMUNIZATION, locationId: CEBU }])
)

describe("Scope matching (ADM-2)", () => {
	it("lets nationwide roles see everything, with or without rows", () => {
		for (const role of ["Super Admin", "System Admin", "Auditor"]) {
			const scope = toResolvedScope(access([role], []))
			expect(scope.nationwide).toBe(true)
			expect(inScope(scope, { serviceCategoryId: PORT_HEALTH, locationId: MANILA })).toBe(true)
		}
	})

	it("limits a scoped user to Immunization at Cebu", () => {
		expect(inScope(cebuImmunization, { serviceCategoryId: IMMUNIZATION, locationId: CEBU })).toBe(true)
		expect(inScope(cebuImmunization, { serviceCategoryId: IMMUNIZATION, locationId: MANILA })).toBe(
			false
		)
		expect(inScope(cebuImmunization, { serviceCategoryId: PORT_HEALTH, locationId: CEBU })).toBe(false)
	})

	it("checks only the dimensions a record has", () => {
		expect(inScope(cebuImmunization, { locationId: CEBU })).toBe(true)
		expect(inScope(cebuImmunization, { locationId: MANILA })).toBe(false)
		expect(inScope(cebuImmunization, { serviceCategoryId: IMMUNIZATION })).toBe(true)
	})

	it("treats a null column as all", () => {
		const allCategoriesAtCebu = toResolvedScope(
			access(["Module Admin"], [{ serviceCategoryId: null, locationId: CEBU }])
		)
		expect(inScope(allCategoriesAtCebu, { serviceCategoryId: PORT_HEALTH, locationId: CEBU })).toBe(true)
		expect(inScope(allCategoriesAtCebu, { serviceCategoryId: PORT_HEALTH, locationId: MANILA })).toBe(
			false
		)
	})

	it("gives a scoped role with no rows nothing", () => {
		const none = toResolvedScope(access(["Cashier"], []))
		expect(inScope(none, { serviceCategoryId: IMMUNIZATION, locationId: CEBU })).toBe(false)
	})

	it("lets an admin give only scopes inside their own", () => {
		const allAtCebu = toResolvedScope(access(["Module Admin"], [{ serviceCategoryId: null, locationId: CEBU }]))
		expect(scopeContains(allAtCebu, [{ serviceCategoryId: IMMUNIZATION, locationId: CEBU }])).toBe(true)
		expect(scopeContains(allAtCebu, [{ serviceCategoryId: null, locationId: CEBU }])).toBe(true)
		expect(scopeContains(allAtCebu, [{ serviceCategoryId: IMMUNIZATION, locationId: MANILA }])).toBe(false)
		expect(scopeContains(allAtCebu, [{ serviceCategoryId: IMMUNIZATION, locationId: null }])).toBe(false)
		expect(scopeContains(cebuImmunization, [{ serviceCategoryId: null, locationId: CEBU }])).toBe(false)
	})

	it("builds no condition for nationwide users and an empty one for users without rows", () => {
		const columns = { serviceCategoryId: {} as never, locationId: {} as never }
		expect(scopeCondition({ nationwide: true }, columns)).toBeUndefined()
		expect(scopeCondition({ nationwide: false, entries: [] }, columns)).toBeDefined()
		expect(
			scopeCondition({ nationwide: false, entries: [{ serviceCategoryId: null, locationId: null }] }, columns)
		).toBeUndefined()
	})
})

describe("ScopeService.assert (ADM-2)", () => {
	function serviceWith(resolved: ResolvedPermissionSet) {
		const rbacService = { getResolvedAccess: jest.fn().mockResolvedValue(resolved) }
		const auditService = { record: jest.fn().mockResolvedValue(undefined) }
		const service = new ScopeService(rbacService as never, auditService as never)
		return { service, auditService }
	}

	const target = { type: "booking", id: 7, notFoundMessage: "Booking with ID 7 not found" }

	it("allows a record in scope without an audit entry", async () => {
		const { service, auditService } = serviceWith(
			access(["Processing Officer"], [{ serviceCategoryId: IMMUNIZATION, locationId: CEBU }])
		)
		await expect(
			service.assert("u1", { serviceCategoryId: IMMUNIZATION, locationId: CEBU }, target)
		).resolves.toBeUndefined()
		expect(auditService.record).not.toHaveBeenCalled()
	})

	it("answers 404 and audits a denial for a record outside scope", async () => {
		const { service, auditService } = serviceWith(
			access(["Processing Officer"], [{ serviceCategoryId: IMMUNIZATION, locationId: CEBU }])
		)
		const attempt = service.assert("u1", { serviceCategoryId: IMMUNIZATION, locationId: MANILA }, target)

		await expect(attempt).rejects.toBeInstanceOf(ORPCError)
		await expect(attempt).rejects.toMatchObject({ code: "NOT_FOUND", message: target.notFoundMessage })
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "scope.check",
				outcome: "denied",
				actorId: "u1",
				targetType: "booking",
				targetId: "7",
				reason: "outside scope",
			})
		)
	})

	it("allows a multi-item record when any item is in scope", async () => {
		const { service } = serviceWith(
			access(["Processing Officer"], [{ serviceCategoryId: IMMUNIZATION, locationId: CEBU }])
		)
		await expect(
			service.assert(
				"u1",
				[
					{ serviceCategoryId: PORT_HEALTH, locationId: MANILA },
					{ serviceCategoryId: IMMUNIZATION, locationId: CEBU },
				],
				target
			)
		).resolves.toBeUndefined()
	})

	it("still answers 404 when the audit write fails", async () => {
		const { service, auditService } = serviceWith(access(["Cashier"], []))
		auditService.record.mockRejectedValue(new Error("database unavailable"))

		await expect(service.assert("u1", { locationId: CEBU }, target)).rejects.toMatchObject({
			code: "NOT_FOUND",
		})
	})
})