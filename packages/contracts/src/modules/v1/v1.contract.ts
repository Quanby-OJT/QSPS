import { oc } from "@orpc/contract"

import { bookingsContract } from "./bookings/bookings.contract.js"
import { walkInContract } from "./bookings/walk-in.contract.js"
import { certificatesContract } from "./certificates/certificates.contract.js"
import { formsContract } from "./forms/forms.contract.js"
import { healthContract } from "./health/health.contract.js"
import { locationsContract } from "./locations/locations.contract.js"
import { meContract } from "./me/me.contract.js"
import { cashierContract } from "./payments/cashier.contract.js"
import { paymentChannelsContract, paymentsContract } from "./payments/payments.contract.js"
import { policiesContract } from "./policies/policies.contract.js"
import { policyDocumentsContract } from "./policies/policy-documents.contract.js"
import { processingContract } from "./processing/processing.contract.js"
import { rbacContract } from "./rbac/rbac.contract.js"
import { schedulesContract } from "./schedules/schedules.contract.js"
import { servicesContract } from "./services/services.contract.js"
import { supportContract } from "./support/support.contract.js"

/**
 * V1 contract router for the versioned service API.
 * Assembles all v1 feature contracts and applies the /v1 prefix
 */
export const v1Contract = oc.prefix("/v1").router(
	oc.router({
		bookings: bookingsContract,
		certificates: certificatesContract,
		health: healthContract,
		locations: locationsContract,
		me: meContract,
		forms: formsContract,
		payments: paymentsContract,
		paymentChannels: paymentChannelsContract,
		cashier: cashierContract,
		policies: policiesContract,
		policyDocuments: policyDocumentsContract,
		processing: processingContract,
		rbac: rbacContract,
		schedules: schedulesContract,
		services: servicesContract,
		support: supportContract,
		// PRC-2: walk-in clients booked by a Processing Officer.
		walkIn: walkInContract,
	})
)

export type V1Contract = typeof v1Contract
