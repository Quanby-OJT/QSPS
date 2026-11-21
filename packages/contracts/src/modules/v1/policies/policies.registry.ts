import { z } from "zod"

/**
 * Policy registry (ADM-6, DOMAIN-MODEL section 4 `policies`).
 *
 * Every admin-editable rule value is declared here once: its key, the area it
 * is grouped under on the policy screen, its type, its allowed range, and its
 * documented default. The API validates a new value against this list before
 * storing it, and the screen renders straight from it, so a key added by a
 * later ticket (retention periods, for example) appears without a screen
 * change. Add a key here and in DOMAIN-MODEL.md in the same pull request.
 *
 * The behaviour each policy drives belongs to the ticket that uses it
 * (BKG-2, BKG-5, BKG-6, BKG-7, PAY-7); ADM-6 only stores and serves values.
 */

/** Groups on the policy screen, in display order. */
export const POLICY_AREAS = ["booking", "payment", "auth"] as const

export type PolicyArea = (typeof POLICY_AREAS)[number]

export const POLICY_AREA_LABELS: Record<PolicyArea, string> = {
	booking: "Booking",
	payment: "Payments and refunds",
	auth: "Sign-in security",
}

interface PolicyDefinitionBase {
	key: string
	area: PolicyArea
	label: string
	description: string
}

export interface IntegerPolicyDefinition extends PolicyDefinitionBase {
	type: "integer"
	min: number
	max: number
	/** Shown after the value, e.g. "minutes". */
	unit: string
	defaultValue: number
}

export interface BooleanPolicyDefinition extends PolicyDefinitionBase {
	type: "boolean"
	defaultValue: boolean
}

export type PolicyDefinition = IntegerPolicyDefinition | BooleanPolicyDefinition

export type PolicyType = PolicyDefinition["type"]

export const POLICY_DEFINITIONS = [
	// Booking (TOR §VIII.3, Annex B)
	{
		key: "booking.hold_minutes",
		area: "booking",
		label: "Unpaid booking hold",
		description:
			"How long an unpaid booking keeps its slot before it can be cancelled automatically.",
		type: "integer",
		min: 5,
		max: 1440,
		unit: "minutes",
		defaultValue: 60,
	},
	{
		key: "booking.arrival_cutoff_minutes",
		area: "booking",
		label: "Arrival cutoff",
		description:
			"Minutes before the slot starts after which a booking that is still unpaid is cancelled.",
		type: "integer",
		min: 0,
		max: 1440,
		unit: "minutes",
		defaultValue: 30,
	},
	{
		key: "booking.max_reschedules",
		area: "booking",
		label: "Reschedules allowed",
		description: "How many times a client may move one booking to another slot.",
		type: "integer",
		min: 0,
		max: 10,
		unit: "times",
		defaultValue: 1,
	},
	{
		key: "booking.reschedule_min_hours_before",
		area: "booking",
		label: "Reschedule notice",
		description: "A client may reschedule only up to this many hours before the slot starts.",
		type: "integer",
		min: 0,
		max: 720,
		unit: "hours",
		defaultValue: 24,
	},
	{
		key: "booking.expedite_enabled",
		area: "booking",
		label: "Expedite requests",
		description: "Whether clients may request a date that has no open slots, for staff approval.",
		type: "boolean",
		defaultValue: true,
	},
	{
		key: "booking.vip_daily_limit",
		area: "booking",
		label: "VIP bookings per day",
		description: "The most VIP bookings staff may create at one location on one day.",
		type: "integer",
		min: 0,
		max: 1000,
		unit: "bookings",
		defaultValue: 10,
	},
	// Payments and refunds (TOR §VIII.3)
	{
		key: "payment.forfeit_on_no_show",
		area: "payment",
		label: "Forfeit on no-show",
		description: "Whether a paid booking is forfeited when the client does not arrive.",
		type: "boolean",
		defaultValue: false,
	},
	{
		key: "payment.refund_window_days",
		area: "payment",
		label: "Refund request window",
		description: "How many days after payment a client may still request a refund.",
		type: "integer",
		min: 0,
		max: 365,
		unit: "days",
		defaultValue: 30,
	},
	// Sign-in security (AUTH-3, TOR §II)
	{
		key: "auth.lockout_threshold",
		area: "auth",
		label: "Failed sign-ins before lock",
		description: "Wrong passwords in a row, for one email, before the account is locked.",
		type: "integer",
		min: 1,
		max: 20,
		unit: "attempts",
		defaultValue: 5,
	},
	{
		key: "auth.lockout_minutes",
		area: "auth",
		label: "Lock length",
		description:
			"How long a locked account stays locked. Failed attempts are counted over the same window.",
		type: "integer",
		min: 1,
		max: 1440,
		unit: "minutes",
		defaultValue: 15,
	},
	{
		key: "auth.staff_password_max_age_days",
		area: "auth",
		label: "Staff password age",
		description: "A staff password older than this must be changed at the next sign-in.",
		type: "integer",
		min: 1,
		max: 365,
		unit: "days",
		defaultValue: 90,
	},
] as const satisfies readonly PolicyDefinition[]

type RegisteredDefinition = (typeof POLICY_DEFINITIONS)[number]

/** A registered Policy key, e.g. "booking.hold_minutes". */
export type PolicyKey = RegisteredDefinition["key"]

/** The value type of one key: a number for integer keys, a boolean for boolean keys. */
export type PolicyValue<K extends PolicyKey> =
	Extract<RegisteredDefinition, { key: K }> extends { type: "integer" } ? number : boolean

/** Every registered key, in registry order. */
export const POLICY_KEYS = POLICY_DEFINITIONS.map(
	definition => definition.key
) as unknown as readonly [PolicyKey, ...PolicyKey[]]

const DEFINITIONS_BY_KEY: ReadonlyMap<string, PolicyDefinition> = new Map(
	POLICY_DEFINITIONS.map(definition => [definition.key, definition as PolicyDefinition])
)

export function isPolicyKey(key: string): key is PolicyKey {
	return DEFINITIONS_BY_KEY.has(key)
}

export function getPolicyDefinition(key: string): PolicyDefinition | undefined {
	return DEFINITIONS_BY_KEY.get(key)
}

/** The schema a value for `definition` must pass: its type, and for integers its range. */
export function policyValueSchema(definition: PolicyDefinition): z.ZodType<number | boolean> {
	if (definition.type === "boolean") {
		return z.boolean({ error: `${definition.label} must be on or off` })
	}
	const message = `${definition.label} must be a whole number from ${definition.min} to ${definition.max}`
	return z
		.number({ error: message })
		.int({ error: message })
		.min(definition.min, { error: message })
		.max(definition.max, { error: message })
}

export type PolicyValidation =
	| { ok: true; value: number | boolean }
	| { ok: false; message: string }

/** Check one value against its key's type and range. Unknown keys are refused. */
export function validatePolicyValue(key: string, value: unknown): PolicyValidation {
	const definition = getPolicyDefinition(key)
	if (!definition) return { ok: false, message: `Unknown policy "${key}"` }

	const parsed = policyValueSchema(definition).safeParse(value)
	if (parsed.success) return { ok: true, value: parsed.data }
	return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid value" }
}
