import { z } from "zod"

import { POLICY_AREAS, POLICY_KEYS, validatePolicyValue } from "./policies.registry.js"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

export const PolicyKeySchema = z.enum(POLICY_KEYS)

export const PolicyValueSchema = z.union([z.number(), z.boolean()])

/** One registered Policy with its current value, as the policy screen shows it. */
export const PolicySchema = z.object({
	key: PolicyKeySchema,
	area: z.enum(POLICY_AREAS),
	label: z.string(),
	description: z.string(),
	type: z.enum(["integer", "boolean"]),
	/** Integer keys only; null for boolean keys. */
	min: z.number().int().nullable(),
	max: z.number().int().nullable(),
	unit: z.string().nullable(),
	/** The documented default, or the env value that replaces it. */
	defaultValue: PolicyValueSchema,
	/** What `PolicyService.get` returns right now. */
	value: PolicyValueSchema,
	/** True when no value is stored, so the default applies. */
	isDefault: z.boolean(),
	updatedAt: dateField.nullable(),
	updatedByEmail: z.string().nullable(),
})

/**
 * Change one Policy. The value is checked against its key's type and range
 * here, so a bad value is a 400 before it reaches the service, which checks
 * again before writing.
 */
export const UpdatePolicyRequestSchema = z
	.object({
		key: PolicyKeySchema,
		value: PolicyValueSchema,
	})
	.superRefine(({ key, value }, ctx) => {
		const result = validatePolicyValue(key, value)
		if (!result.ok) ctx.addIssue({ code: "custom", path: ["value"], message: result.message })
	})

export type Policy = z.infer<typeof PolicySchema>
export type UpdatePolicyRequest = z.infer<typeof UpdatePolicyRequestSchema>
