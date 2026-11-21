import { z } from "zod"

/** A 6-digit code from an authenticator app or the sign-in email (AUTH-2). */
export const OneTimeCodeSchema = z
	.string()
	.trim()
	.regex(/^\d{6}$/, "Enter the 6-digit code.")

/** One of the saved recovery codes (AUTH-2). */
export const RecoveryCodeSchema = z.string().trim().min(1, "Enter one of your recovery codes.")

/** The account password, asked again before a security change (AUTH-2). */
export const PasswordConfirmSchema = z.string().min(1, "Enter your password.")
