import { Injectable } from "@nestjs/common"

import { authEnv, createTransport, sendMail, type MailMessage } from "@repo/auth"

export interface EmailSender {
	send(message: MailMessage): Promise<void>
}

@Injectable()
export class TemplateEmailSender implements EmailSender {
	private transport: ReturnType<typeof createTransport> | undefined

	async send(message: MailMessage): Promise<void> {
		if (!authEnv.SMTP_HOST) {
			throw new Error("Notification SMTP is not configured")
		}

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
