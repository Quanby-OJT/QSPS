import {
	BUSINESS_TIMEZONE,
	POLICY_AREA_LABELS,
	POLICY_AREAS,
	validatePolicyValue,
	type AnyPolicyValue,
	type Policy,
	type PolicyArea,
} from "@repo/contracts"

/** What the admin is editing: the text in a number or text field, or a checkbox state. */
export type PolicyDraft = string | boolean

export interface PolicyGroup {
	area: PolicyArea
	label: string
	policies: Policy[]
}

/** Policies grouped by area, in the registry's area order. Areas with no policies are left out. */
export function groupPolicies(policies: readonly Policy[]): PolicyGroup[] {
	return POLICY_AREAS.map(area => ({
		area,
		label: POLICY_AREA_LABELS[area],
		policies: policies.filter(policy => policy.area === area),
	})).filter(group => group.policies.length > 0)
}

export function draftOf(policy: Policy): PolicyDraft {
	return policy.type === "boolean" ? policy.value === true : String(policy.value)
}

export type ParsedDraft = { ok: true; value: AnyPolicyValue } | { ok: false; message: string }

/**
 * Turn a draft into a value, checked against the same rule the API applies.
 * A blank text field is a valid value: it hides that help desk channel.
 */
export function parseDraft(policy: Policy, draft: PolicyDraft): ParsedDraft {
	if (policy.type === "boolean") {
		return validatePolicyValue(policy.key, draft === true)
	}
	const text = typeof draft === "string" ? draft.trim() : ""
	if (policy.type === "text") return validatePolicyValue(policy.key, text)
	if (text === "") return { ok: false, message: `Enter a value for ${policy.label}` }
	return validatePolicyValue(policy.key, Number(text))
}

/** True when the draft would change what is stored. */
export function isChanged(policy: Policy, draft: PolicyDraft): boolean {
	const parsed = parseDraft(policy, draft)
	return !parsed.ok || parsed.value !== policy.value
}

export function formatPolicyValue(policy: Policy, value: AnyPolicyValue): string {
	if (policy.type === "boolean") return value === true ? "On" : "Off"
	if (policy.type === "text") return value === "" ? "Not set" : String(value)
	return policy.unit ? `${String(value)} ${policy.unit}` : String(value)
}

/** The hint under a field when there is no error. */
export function fieldHint(policy: Policy): string {
	if (policy.type === "integer") return `From ${String(policy.min)} to ${String(policy.max)}`
	if (policy.type === "boolean") return "On or off"
	return "Leave blank to hide it on the Help page"
}

/** The input type for a text policy, so phones get a dial pad and links a URL keyboard. */
export function textInputType(policy: Policy): "tel" | "email" | "url" | "text" {
	switch (policy.format) {
		case "phone":
			return "tel"
		case "email":
			return "email"
		case "url":
			return "url"
		default:
			return "text"
	}
}

const changedAtFormat = new Intl.DateTimeFormat("en-PH", {
	timeZone: BUSINESS_TIMEZONE,
	dateStyle: "medium",
	timeStyle: "short",
})

/** "Changed by admin@qsps.local on 21 Nov 2026, 11:07 PM", in Manila time. */
export function changedLabel(policy: Policy): string | null {
	if (policy.isDefault || !policy.updatedAt) return null
	const when = changedAtFormat.format(new Date(policy.updatedAt))
	return policy.updatedByEmail
		? `Changed by ${policy.updatedByEmail} on ${when}`
		: `Changed on ${when}`
}
