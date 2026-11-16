import { z } from "zod"

export const RegisterSchema = z.object({
	name: z.string().min(1, "Name is required"),
	email: z.email("Please enter a valid email address"),
	password: z.string().min(8, "Password must be at least 8 characters"),
	/** Data Privacy Act consent (AUTH-1): no account is created without it. */
	privacyAccepted: z
		.boolean()
		.refine(accepted => accepted, "Please accept the privacy notice to create an account"),
})

export type Register = z.infer<typeof RegisterSchema>
