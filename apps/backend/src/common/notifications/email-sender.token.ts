import type { MailMessage } from "@repo/auth"

/**
 * Sends one rendered email (NTF-1). The worker depends on this interface, not
 * on a mailer, so another provider can be plugged in without touching it.
 */
export interface EmailSender {
	send(message: MailMessage): Promise<void>
}

/** Nest injection token for the configured `EmailSender`. */
export const EMAIL_SENDER = Symbol("EMAIL_SENDER")
