import { z } from "zod"

import { PRIVACY_NOTICE_VERSION } from "../../../common/privacy-notice.js"
import { CreateBookingSchema } from "./bookings.schema.js"

/**
 * Walk-in clients (PRC-2, Annex A). A Processing Officer encodes a client who
 * came to the BOQ office without booking online, and books them into today's
 * schedule at the officer's Location. TOR §VIII.2 forbids guest transactions,
 * so the client always has an account: an existing one, or one created here
 * without a password, which the client sets from the emailed invitation.
 *
 * PRC-2b: a client may have only a mobile number. The account then stores a
 * placeholder email the API never returns: `email` is null in every response
 * and screens show "No email".
 */

const dateField = z.union([z.date(), z.string()]).transform(value => new Date(value))

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date in YYYY-MM-DD, not in the future, not before 1900. */
function isValidBirthDate(value: string): boolean {
	if (!ISO_DATE.test(value)) return false
	const date = new Date(`${value}T00:00:00Z`)
	if (Number.isNaN(date.getTime())) return false
	if (date.toISOString().slice(0, 10) !== value) return false
	return date.getUTCFullYear() >= 1900 && date.getTime() <= Date.now()
}

/** Shortest lookup text: an email or a mobile number, or enough of one. */
export const MIN_WALK_IN_LOOKUP_LENGTH = 5
/** Most clients a lookup returns. */
export const MAX_WALK_IN_LOOKUP_RESULTS = 10

/** Find a client account by email address or mobile number (exact match). */
export const WalkInClientLookupSchema = z.object({
	query: z
		.string()
		.trim()
		.min(MIN_WALK_IN_LOOKUP_LENGTH, "Enter the client's email address or mobile number")
		.max(100),
})

/** A client account staff can book for. */
export const WalkInClientSchema = z.object({
	id: z.string(),
	name: z.string(),
	/** Null for a mobile-only client (show "No email"). */
	email: z.string().nullable(),
	mobile: z.string().nullable(),
	/** YYYY-MM-DD */
	birthDate: z.string().nullable(),
	nationality: z.string().nullable(),
	gender: z.string().nullable(),
	/** The client has not set a password yet (a walk-in account still waiting for its invitation). */
	invitationPending: z.boolean(),
})

/** Emails typed at the counter must be real: `.invalid` is the placeholder's domain. */
function isRealEmail(value: string): boolean {
	return !value.endsWith(".invalid")
}

/**
 * An optional email address. Empty means none. A client signs in with it and
 * the invitation to set a password goes there.
 */
const optionalEmail = z
	.string()
	.trim()
	.toLowerCase()
	.refine(
		value => value === "" || z.email().safeParse(value).success,
		"Enter a valid email address"
	)
	.refine(value => value.length <= 254, "That email address is too long")
	.refine(isRealEmail, "Enter the client's real email address, or leave it empty")
	.transform(value => (value === "" ? null : value))
	.nullish()
	.transform(value => value ?? null)

/**
 * A new client account for a walk-in (PRC-2, PRC-2b). The client needs an
 * email address or a mobile number. Without an email, no invitation is sent
 * until one is added (`addClientEmail`) or SMS invitations exist (NTF-2).
 *
 * `privacyNoticeVersion` is sent only when the officer ticks "Client accepted
 * the Privacy Notice", and must be the version currently shown.
 */
export const CreateWalkInClientSchema = z
	.object({
		name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
		email: optionalEmail,
		/** Spaces and dashes are removed; then 10–15 digits, optionally starting with +. Empty means none. */
		mobile: z
			.string()
			.trim()
			.transform(value => value.replace(/[\s-]/g, ""))
			.refine(value => value === "" || /^\+?\d{10,15}$/.test(value), "Enter a valid mobile number")
			.transform(value => (value === "" ? null : value))
			.nullish()
			.transform(value => value ?? null),
		birthDate: z.string().trim().refine(isValidBirthDate, "Enter a valid birth date (YYYY-MM-DD)"),
		nationality: z
			.string()
			.trim()
			.min(2, "Nationality is required")
			.max(60, "Nationality is too long"),
		gender: z.string().trim().min(1, "Gender is required").max(50, "Gender is too long"),
		privacyNoticeVersion: z.literal(PRIVACY_NOTICE_VERSION, {
			error: "The client must accept the Privacy Notice before the account is created",
		}),
	})
	.refine(client => client.email !== null || client.mobile !== null, {
		message: "Enter the client's email address or mobile number",
		path: ["email"],
	})

/** Add a real email address to a client who has none (PRC-2b). */
export const AddWalkInClientEmailSchema = z.object({
	clientId: z.string().trim().min(1).max(64),
	email: z
		.string()
		.trim()
		.toLowerCase()
		.pipe(z.email("Enter a valid email address").max(254, "That email address is too long"))
		.refine(isRealEmail, "Enter the client's real email address"),
})

/** Which Service to list today's slots for. */
export const WalkInSlotsRequestSchema = z.object({
	serviceId: z.coerce.number().int().positive(),
})

/** One of today's slots at the officer's Location. */
export const WalkInSlotSchema = z.object({
	id: z.number().int().positive(),
	startsAt: dateField,
	endsAt: dateField,
	capacity: z.number().int().min(0),
	bookedCount: z.number().int().min(0),
	/** Places left. A full slot is listed with 0 and cannot be chosen. */
	remaining: z.number().int().min(0),
	/** Already started and not yet ended: a walk-in may still be booked into it. */
	inProgress: z.boolean(),
})

export const WalkInSlotsSchema = z.object({
	/** The officer's Location; null when they have none, so nothing can be booked. */
	location: z.object({ id: z.number().int().positive(), name: z.string() }).nullable(),
	/** Today, in Manila (YYYY-MM-DD). */
	date: z.string(),
	slots: z.array(WalkInSlotSchema),
})

/**
 * Book a walk-in client: the same checkout as a client's own booking
 * (BKG-1, BKG-3, FRM-2, ADM-9), for `clientId`, into today's slots at the
 * officer's Location. `acceptedPolicyDocumentIds` are the policies the
 * client read and accepted at the counter.
 */
export const CreateWalkInBookingSchema = CreateBookingSchema.extend({
	clientId: z.string().trim().min(1, "Choose the client").max(64),
})

export type WalkInClientLookup = z.infer<typeof WalkInClientLookupSchema>
export type WalkInClient = z.infer<typeof WalkInClientSchema>
export type CreateWalkInClientInput = z.infer<typeof CreateWalkInClientSchema>
export type AddWalkInClientEmailInput = z.infer<typeof AddWalkInClientEmailSchema>
export type WalkInSlotsRequest = z.infer<typeof WalkInSlotsRequestSchema>
export type WalkInSlot = z.infer<typeof WalkInSlotSchema>
export type WalkInSlots = z.infer<typeof WalkInSlotsSchema>
export type CreateWalkInBookingInput = z.infer<typeof CreateWalkInBookingSchema>
