import { z } from "zod"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

/** Longest policy title and body a client is asked to read. */
export const MAX_POLICY_TITLE_LENGTH = 200
export const MAX_POLICY_BODY_LENGTH = 20_000
/** Most Services one policy may list; above this, "all Services" is the honest choice. */
export const MAX_POLICY_SERVICES = 200

/** A Manila calendar date, YYYY-MM-DD, that exists. */
export const PolicyEffectiveDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD")
	.refine(value => {
		const date = new Date(`${value}T00:00:00Z`)
		return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
	}, "Enter a real date")

/** The key every version of one policy shares. */
export const PolicyDocumentKeySchema = z.uuid({ error: "Unknown policy" })

/** Where a policy stands today: applying now, waiting for its date, or withdrawn. */
export const POLICY_DOCUMENT_STATES = ["in_effect", "scheduled", "withdrawn"] as const
export const PolicyDocumentStateSchema = z.enum(POLICY_DOCUMENT_STATES)

/**
 * One policy version as a client sees it: on the booking review step, in the
 * booking API for the mobile app, and on the public policies page.
 */
export const PolicyDocumentSummarySchema = z.object({
	/** The version's own id; this is what a client accepts. */
	id: z.number().int().positive(),
	documentKey: PolicyDocumentKeySchema,
	version: z.number().int().positive(),
	title: z.string(),
	/** Plain text. Blank lines separate paragraphs; never HTML. */
	body: z.string(),
	requiresAcceptance: z.boolean(),
	effectiveFrom: z.string(),
	appliesToAllServices: z.boolean(),
	/** Names of the Services it applies to; empty when it applies to all. */
	serviceNames: z.array(z.string()),
})

/** The newest version of one policy, as the admin list shows it. */
export const PolicyDocumentSchema = PolicyDocumentSummarySchema.extend({
	serviceIds: z.array(z.number().int().positive()),
	state: PolicyDocumentStateSchema,
	/** True when an older version still applies until this one's date. */
	olderVersionInEffect: z.boolean(),
	withdrawnAt: dateField.nullable(),
	createdAt: dateField,
	createdByEmail: z.string().nullable(),
})

const PolicyDocumentFieldsSchema = z.object({
	title: z
		.string()
		.trim()
		.min(1, "Enter a title")
		.max(MAX_POLICY_TITLE_LENGTH, `Keep the title to ${MAX_POLICY_TITLE_LENGTH} characters`),
	body: z
		.string()
		.trim()
		.min(1, "Enter the policy text")
		.max(MAX_POLICY_BODY_LENGTH, `Keep the text to ${MAX_POLICY_BODY_LENGTH} characters`),
	appliesToAllServices: z.boolean(),
	serviceIds: z
		.array(z.number().int().positive())
		.max(MAX_POLICY_SERVICES, `Choose at most ${MAX_POLICY_SERVICES} services`)
		.default([]),
	effectiveFrom: PolicyEffectiveDateSchema,
	requiresAcceptance: z.boolean(),
})

type PolicyDocumentFields = z.infer<typeof PolicyDocumentFieldsSchema>

/**
 * A policy applies to all Services, or to at least one listed Service. The
 * list is cleared when it applies to all, and repeated ids are dropped.
 */
function withServiceRule<T extends z.ZodType<PolicyDocumentFields>>(schema: T) {
	return schema
		.superRefine((value, ctx) => {
			if (!value.appliesToAllServices && value.serviceIds.length === 0) {
				ctx.addIssue({
					code: "custom",
					path: ["serviceIds"],
					message: "Choose at least one service, or apply it to all services",
				})
			}
		})
		.transform(value => ({
			...value,
			serviceIds: value.appliesToAllServices
				? []
				: [...new Set(value.serviceIds)].sort((a, b) => a - b),
		}))
}

/** Write a new policy (version 1). Requires settings.policies:manage. */
export const CreatePolicyDocumentSchema = withServiceRule(PolicyDocumentFieldsSchema)

/**
 * Edit a policy: every field is sent again and stored as the next version.
 * Earlier versions, and the acceptances that point at them, are kept.
 */
export const UpdatePolicyDocumentSchema = withServiceRule(
	PolicyDocumentFieldsSchema.extend({ documentKey: PolicyDocumentKeySchema })
)

export const PolicyDocumentKeyParamSchema = z.object({ documentKey: PolicyDocumentKeySchema })

/** The Service a client is about to book; path and query values arrive as text. */
export const ApplicablePoliciesRequestSchema = z.object({
	serviceId: z.coerce.number().int().positive(),
})

export type PolicyDocumentState = z.infer<typeof PolicyDocumentStateSchema>
export type PolicyDocumentSummary = z.infer<typeof PolicyDocumentSummarySchema>
export type PolicyDocument = z.infer<typeof PolicyDocumentSchema>
export type CreatePolicyDocumentInput = z.infer<typeof CreatePolicyDocumentSchema>
export type UpdatePolicyDocumentInput = z.infer<typeof UpdatePolicyDocumentSchema>
export type ApplicablePoliciesRequest = z.infer<typeof ApplicablePoliciesRequestSchema>
