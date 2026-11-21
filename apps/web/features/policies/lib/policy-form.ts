import {
	BUSINESS_TIMEZONE,
	POLICY_AREA_LABELS,
	POLICY_AREAS,
	validatePolicyValue,
	type Policy,
	type PolicyArea,
} from "@repo/contracts"

/** What the admin is editing: the text in a number field, or a checkbox state. */
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

export type ParsedDraft = { ok: true; value: number | boolean } | { ok: false; message: string }

/** Turn a draft into a value, checked against the same rule the API applies. */
export function parseDraft(policy: Policy, draft: PolicyDraft): ParsedDraft {
	if (policy.type === "boolean") {
		return validatePolicyValue(policy.key, draft === true)
	}
	const text = typeof draft === "string" ? draft.trim() : ""
	if (text === "") return { ok: false, message: `Enter a value for ${policy.label}` }
	return validatePolicyValue(policy.key, Number(text))
}

/** True when the draft would change what is stored. */
export function isChanged(policy: Policy, draft: PolicyDraft): boolean {
	const parsed = parseDraft(policy, draft)
	return !parsed.ok || parsed.value !== policy.value
}

export function formatPolicyValue(policy: Policy, value: number | boolean): string {
	if (policy.type === "boolean") return value === true ? "On" : "Off"
	return policy.unit ? `${String(value)} ${policy.unit}` : String(value)
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
