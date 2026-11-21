import { z } from "zod"

export const ChangePasswordSchema = z
	.object({
		currentPassword: z.string().min(1, "Enter your current password"),
		newPassword: z.string().min(8, "Password must be at least 8 characters"),
		confirmPassword: z.string().min(1, "Please confirm your new password"),
	})
	.refine(data => data.confirmPassword === data.newPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	})
	.refine(data => data.newPassword !== data.currentPassword, {
		message: "Choose a password different from your current one",
		path: ["newPassword"],
	})

export type ChangePassword = z.infer<typeof ChangePasswordSchema>