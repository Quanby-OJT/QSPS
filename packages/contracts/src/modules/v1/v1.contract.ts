import { oc } from "@orpc/contract"

import { healthContract } from "./health/health.contract.js"
import { locationsContract } from "./locations/locations.contract.js"
import { meContract } from "./me/me.contract.js"
import { rbacContract } from "./rbac/rbac.contract.js"

/**
 * V1 contract router (versioned paths: /v1/health, /v1/me, /v1/rbac)
 * Assembles all v1 feature contracts and applies the /v1 prefix
 */
export const v1Contract = oc.prefix("/v1").router(
	oc.router({
		health: healthContract,
		locations: locationsContract,
		me: meContract,
		rbac: rbacContract,
	})
)

export type V1Contract = typeof v1Contract
