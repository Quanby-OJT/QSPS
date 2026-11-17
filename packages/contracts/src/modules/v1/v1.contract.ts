import { oc } from "@orpc/contract"

import { bookingsContract } from "./bookings/bookings.contract.js"
import { healthContract } from "./health/health.contract.js"
import { locationsContract } from "./locations/locations.contract.js"
import { meContract } from "./me/me.contract.js"
import { paymentsContract } from "./payments/payments.contract.js"
import { rbacContract } from "./rbac/rbac.contract.js"
import { schedulesContract } from "./schedules/schedules.contract.js"
import { servicesContract } from "./services/services.contract.js"

/**
 * V1 contract router for the versioned service API.
 * Assembles all v1 feature contracts and applies the /v1 prefix
 */
export const v1Contract = oc.prefix("/v1").router(
	oc.router({
		bookings: bookingsContract,
		health: healthContract,
		locations: locationsContract,
		me: meContract,
		payments: paymentsContract,
		rbac: rbacContract,
		schedules: schedulesContract,
		services: servicesContract,
	})
)

export type V1Contract = typeof v1Contract
