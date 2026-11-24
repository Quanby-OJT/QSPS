import { oc } from "@orpc/contract"
import { z } from "zod"

import {
	ApplicablePoliciesRequestSchema,
	PolicyDocumentSummarySchema,
} from "../policies/policy-documents.schema.js"
import {
	BookingFormRequestSchema,
	BookingFormSchema,
	BookingSchema,
	FormUploadInputSchema,
	FormUploadSchema,
} from "./bookings.schema.js"
import {
	AddWalkInClientEmailSchema,
	CreateWalkInBookingSchema,
	CreateWalkInClientSchema,
	WalkInClientLookupSchema,
	WalkInClientSchema,
	WalkInSlotsRequestSchema,
	WalkInSlotsSchema,
} from "./walk-in.schema.js"

/**
 * PRC-2: a Processing Officer encodes a walk-in client and books them into
 * today's schedule at the officer's Location. Every route needs
 * bookings.walk-in:create (403 and a denied audit without it).
 */
export const walkInContract = {
	lookupClients: oc
		.route({
			method: "GET",
			path: "/walk-in/clients",
			summary: "Find a client account by email or mobile",
			description:
				"Client accounts whose email address or mobile number matches exactly (mobile numbers match on their last ten digits, so 09… and +639… find the same client). Disabled and deleted accounts are left out. Needs bookings.walk-in:create.",
			tags: ["Walk-in"],
		})
		.input(WalkInClientLookupSchema)
		.output(z.array(WalkInClientSchema)),

	createClient: oc
		.route({
			method: "POST",
			path: "/walk-in/clients",
			summary: "Create a client account for a walk-in",
			description:
				"Creates a client account with no password, flagged to set one at first sign-in, and emails the client an invitation link to set it (staff never set credentials). The client needs an email address or a mobile number; without an email no invitation is sent and `email` is null. `privacyNoticeVersion` records that the client accepted the current Privacy Notice at the counter (400 without it). Refused with 409 when an account already has this email or mobile number; the error data carries its clientId so staff can select it instead. Audited without personal data. Needs bookings.walk-in:create.",
			tags: ["Walk-in"],
		})
		.input(CreateWalkInClientSchema)
		.output(WalkInClientSchema),

	addClientEmail: oc
		.route({
			method: "PUT",
			path: "/walk-in/clients/{clientId}/email",
			summary: "Add an email address to a client who has none",
			description:
				"For a mobile-only walk-in client: replaces the stored placeholder with a real email address and, when the client has not set a password yet, emails the invitation. Refused with 409 when the client already has an email address or another account has this one. Audited without personal data. Needs bookings.walk-in:create.",
			tags: ["Walk-in"],
		})
		.input(AddWalkInClientEmailSchema)
		.output(WalkInClientSchema),

	slots: oc
		.route({
			method: "GET",
			path: "/walk-in/slots",
			summary: "Today's slots for a service at your Location",
			description:
				"The Service's slots today (Manila) at the caller's Location that have not ended, with the places left, including a slot already in progress. Empty with location null when the caller has no Location. Needs bookings.walk-in:create.",
			tags: ["Walk-in"],
		})
		.input(WalkInSlotsRequestSchema)
		.output(WalkInSlotsSchema),

	policies: oc
		.route({
			method: "GET",
			path: "/walk-in/policies",
			summary: "Policies the walk-in client must read",
			description:
				"The written policies a client must read, and may have to accept, before booking this Service today (ADM-9); staff show them to the client at the counter. Needs bookings.walk-in:create.",
			tags: ["Walk-in"],
		})
		.input(ApplicablePoliciesRequestSchema)
		.output(z.array(PolicyDocumentSummarySchema)),

	form: oc
		.route({
			method: "GET",
			path: "/walk-in/form",
			summary: "The questionnaire for a walk-in booking",
			description:
				"The Service's active questionnaire (FRM-2), or null when it has none. Staff fill it in with the client. Needs bookings.walk-in:create.",
			tags: ["Walk-in"],
		})
		.input(BookingFormRequestSchema)
		.output(BookingFormSchema.nullable()),

	uploadFormFile: oc
		.route({
			method: "POST",
			path: "/walk-in/form-uploads",
			summary: "Upload a file answer for a walk-in",
			description:
				"Stores a PDF, JPG or PNG of at most 5 MB under the officer's own upload folder and returns its fileKey for a file question (FRM-2). Needs bookings.walk-in:create.",
			tags: ["Walk-in"],
		})
		.input(FormUploadInputSchema)
		.output(FormUploadSchema),

	createBooking: oc
		.route({
			method: "POST",
			path: "/walk-in/bookings",
			summary: "Book a walk-in client",
			description:
				"Creates a Booking with kind walk-in in pending_payment for the client, recorded as created by the officer, through the same checkout as online booking (slots, capacity, questionnaire, policies). Every slot must be today and at the caller's Location; a slot already in progress may be chosen. A slot outside the caller's Scope or Location answers 404 and is audited. The client pays at the cashier (PAY-4); the payment hold applies, the arrival cutoff does not. Needs bookings.walk-in:create.",
			tags: ["Walk-in"],
		})
		.input(CreateWalkInBookingSchema)
		.output(BookingSchema),
}
