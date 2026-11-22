import {
	BUSINESS_TIMEZONE,
	CreatePolicyDocumentSchema,
	type CreatePolicyDocumentInput,
	type PolicyDocument,
	type PolicyDocumentSummary,
} from "@repo/contracts"

/** Today's date in Manila, YYYY-MM-DD. */
export function manilaToday(now: Date = new Date()): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: BUSINESS_TIMEZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(now)
}

const longDate = new Intl.DateTimeFormat("en-PH", { dateStyle: "long", timeZone: "UTC" })

/** "1 December 2026" for a YYYY-MM-DD date. */
export function formatPolicyDate(date: string): string {
	return longDate.format(new Date(`${date}T00:00:00Z`))
}

/** The text split into paragraphs at blank lines. Shown as text, never as HTML. */
export function policyParagraphs(body: string): string[] {
	return body
		.split(/\r?\n\s*\r?\n/)
		.map(paragraph => paragraph.trim())
		.filter(paragraph => paragraph.length > 0)
}

/** "All services", or the names of the Services it applies to. */
export function appliesToLabel(policy: PolicyDocumentSummary): string {
	return policy.appliesToAllServices ? "All services" : policy.serviceNames.join(", ")
}

/** The status line on the admin list. */
export function stateLabel(policy: PolicyDocument): string {
	if (policy.state === "withdrawn") return "Withdrawn"
	if (policy.state === "scheduled") return `Starts ${formatPolicyDate(policy.effectiveFrom)}`
	return "In effect"
}

/** What the admin is editing. */
export interface PolicyDraft {
	title: string
	body: string
	appliesToAllServices: boolean
	serviceIds: number[]
	effectiveFrom: string
	requiresAcceptance: boolean
}

export function emptyDraft(now: Date = new Date()): PolicyDraft {
	return {
		title: "",
		body: "",
		appliesToAllServices: true,
		serviceIds: [],
		effectiveFrom: manilaToday(now),
		requiresAcceptance: true,
	}
}

/** The next version starts from the current one, dated today at the earliest. */
export function draftFrom(policy: PolicyDocument, now: Date = new Date()): PolicyDraft {
	const today = manilaToday(now)
	return {
		title: policy.title,
		body: policy.body,
		appliesToAllServices: policy.appliesToAllServices,
		serviceIds: [...policy.serviceIds],
		effectiveFrom: policy.effectiveFrom < today ? today : policy.effectiveFrom,
		requiresAcceptance: policy.requiresAcceptance,
	}
}

export type ParsedPolicyDraft =
	| { ok: true; value: CreatePolicyDocumentInput }
	| { ok: false; message: string }

/** The draft checked with the same rules the API applies, plus "not in the past". */
export function parsePolicyDraft(draft: PolicyDraft, now: Date = new Date()): ParsedPolicyDraft {
	const parsed = CreatePolicyDocumentSchema.safeParse(draft)
	if (!parsed.success) {
		return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the policy" }
	}
	if (parsed.data.effectiveFrom < manilaToday(now)) {
		return { ok: false, message: "The effective date cannot be in the past" }
	}
	return { ok: true, value: parsed.data }
}

/** The ids of the policies that must be accepted and are not yet. */
export function missingAcceptances(
	policies: readonly PolicyDocumentSummary[],
	accepted: ReadonlySet<number>
): PolicyDocumentSummary[] {
	return policies.filter(policy => policy.requiresAcceptance && !accepted.has(policy.id))
}
