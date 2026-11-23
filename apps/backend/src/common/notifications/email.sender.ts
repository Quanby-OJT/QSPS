import { Injectable } from "@nestjs/common"

import { authEnv, createTransport, sendMail, type MailMessage } from "@repo/auth"

import type { EmailSender } from "./email-sender.token"

/**
 * The template mailer from `@repo/auth`, sending from `MAIL_FROM` (BOQ's
 * registered sender name in production).
 *
 * Same transport rules as the auth emails: real SMTP when `SMTP_HOST` is set,
 * the development transport (serialized, not delivered) when it is not, and
 * an error in production without `SMTP_HOST`.
 */
@Injectable()
export class TemplateEmailSender implements EmailSender {
	private transport: ReturnType<typeof createTransport> | undefined

	async send(message: MailMessage): Promise<void> {
		this.transport ??= createTransport({
			smtpHost: authEnv.SMTP_HOST,
			smtpPort: authEnv.SMTP_PORT,
			smtpUser: authEnv.SMTP_USER,
			smtpPass: authEnv.SMTP_PASS,
			smtpSecure: authEnv.SMTP_SECURE,
			nodeEnv: process.env.NODE_ENV,
		})

		await sendMail(this.transport, authEnv.MAIL_FROM, message)
	}
}
