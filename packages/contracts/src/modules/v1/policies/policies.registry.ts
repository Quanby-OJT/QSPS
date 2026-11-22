import { z } from "zod"

/**
 * Policy registry (ADM-6, ADM-8, DOMAIN-MODEL section 4 `policies`).
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
 * The help desk channels (ADM-8) are text keys: an empty value hides the
 * channel on the Help pages.
 */

/** Groups on the policy screen, in display order. */
export const POLICY_AREAS = ["booking", "payment", "auth", "support"] as const

export type PolicyArea = (typeof POLICY_AREAS)[number]

export const POLICY_AREA_LABELS: Record<PolicyArea, string> = {
	booking: "Booking",
	payment: "Payments and refunds",
	auth: "Sign-in security",
	support: "Help desk",
}

/** How a text Policy is checked, and which input the policy screen shows for it. */
export const POLICY_TEXT_FORMATS = ["phone", "email", "url", "text"] as const

export type PolicyTextFormat = (typeof POLICY_TEXT_FORMATS)[number]

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

/** Free text, checked by format. An empty string is always allowed and means "not set". */
export interface TextPolicyDefinition extends PolicyDefinitionBase {
	type: "text"
	format: PolicyTextFormat
	maxLength: number
	defaultValue: string
}

export type PolicyDefinition =
	| IntegerPolicyDefinition
	| BooleanPolicyDefinition
	| TextPolicyDefinition

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
	// Help desk (ADM-8, TOR §IX). Shown on the public, client and admin Help pages.
	{
		key: "support.phone",
		area: "support",
		label: "Help desk phone",
		description: "The number clients call for help. Leave blank to hide it.",
		type: "text",
		format: "phone",
		maxLength: 30,
		defaultValue: "",
	},
	{
		key: "support.email",
		area: "support",
		label: "Help desk email",
		description: "The address clients write to for help. Leave blank to hide it.",
		type: "text",
		format: "email",
		maxLength: 254,
		defaultValue: "",
	},
	{
		key: "support.ticket_url",
		area: "support",
		label: "Ticketing link",
		description:
			"The https:// address where clients open a help desk ticket. Leave blank to hide it.",
		type: "text",
		format: "url",
		maxLength: 500,
		defaultValue: "",
	},
	{
		key: "support.hours",
		area: "support",
		label: "Support hours",
		description:
			"When the help desk answers, e.g. Monday to Friday, 8:00 AM to 5:00 PM. Leave blank to hide it.",
		type: "text",
		format: "text",
		maxLength: 200,
		defaultValue: "",
	},
] as const satisfies readonly PolicyDefinition[]

type RegisteredDefinition = (typeof POLICY_DEFINITIONS)[number]

/** A registered Policy key, e.g. "booking.hold_minutes". */
export type PolicyKey = RegisteredDefinition["key"]

/** The value type of one key: a number, a boolean or a string, by the key's type. */
export type PolicyValue<K extends PolicyKey> =
	Extract<RegisteredDefinition, { key: K }> extends { type: "integer" }
		? number
		: Extract<RegisteredDefinition, { key: K }> extends { type: "boolean" }
			? boolean
			: string

/** Any Policy value. */
export type AnyPolicyValue = number | boolean | string

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

/** An https address with a real domain name, e.g. https://help.example.gov.ph/tickets. */
const HTTPS_URL = z.url({ protocol: /^https$/, hostname: z.regexes.domain })
const PHONE_PATTERN = /^\+?[0-9(][0-9 ()-]*[0-9]$/

/** Whether a trimmed, non-empty text value fits its format. */
function fitsTextFormat(format: PolicyTextFormat, value: string): boolean {
	switch (format) {
		case "phone": {
			const digits = value.replace(/[^0-9]/g, "").length
			return PHONE_PATTERN.test(value) && digits >= 7 && digits <= 15
		}
		case "email":
			return z.email().safeParse(value).success
		case "url":
			return HTTPS_URL.safeParse(value).success
		case "text":
			return true
	}
}

const TEXT_FORMAT_HINTS: Record<PolicyTextFormat, string> = {
	phone: "a phone number of 7 to 15 digits, e.g. +63 2 8123 4567",
	email: "an email address",
	url: "a full https:// address",
	text: "text",
}

function textValueSchema(definition: TextPolicyDefinition): z.ZodType<string> {
	const { label, maxLength, format } = definition
	return z
		.string({ error: `${label} must be text` })
		.trim()
		.max(maxLength, { error: `${label} must be at most ${maxLength} characters` })
		.refine(value => value === "" || fitsTextFormat(format, value), {
			error: `${label} must be ${TEXT_FORMAT_HINTS[format]}, or blank to hide it`,
		})
}

/**
 * The schema a value for `definition` must pass: its type, for integers its
 * range, and for text its length and format. Text is trimmed.
 */
export function policyValueSchema(definition: PolicyDefinition): z.ZodType<AnyPolicyValue> {
	if (definition.type === "boolean") {
		return z.boolean({ error: `${definition.label} must be on or off` })
	}
	if (definition.type === "text") return textValueSchema(definition)
	const message = `${definition.label} must be a whole number from ${definition.min} to ${definition.max}`
	return z
		.number({ error: message })
		.int({ error: message })
		.min(definition.min, { error: message })
		.max(definition.max, { error: message })
}

export type PolicyValidation = { ok: true; value: AnyPolicyValue } | { ok: false; message: string }

/** Check one value against its key's rule. Unknown keys are refused. Text comes back trimmed. */
export function validatePolicyValue(key: string, value: unknown): PolicyValidation {
	const definition = getPolicyDefinition(key)
	if (!definition) return { ok: false, message: `Unknown policy "${key}"` }

	const parsed = policyValueSchema(definition).safeParse(value)
	if (parsed.success) return { ok: true, value: parsed.data }
	return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid value" }
}
