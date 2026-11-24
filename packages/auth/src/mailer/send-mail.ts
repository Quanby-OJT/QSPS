import type { Transporter } from "nodemailer"

/**
 * A fully-rendered email message ready to send.
 */
export type MailMessage = {
	to: string
	subject: string
	html: string
	text: string
	attachments?: {
		filename: string
		content: Buffer
		cid?: string
		contentType?: string
	}[]
}

/**
 * Whether an address is in the reserved `.invalid` top-level domain (RFC 2606),
 * which can never receive mail. Mobile-only walk-in accounts (PRC-2b) store
 * `<userId>@no-email.invalid` because Better Auth needs an email.
 */
export function isUndeliverableAddress(address: string): boolean {
	const domain = address.trim().toLowerCase().split("@").pop() ?? ""
	return domain === "invalid" || domain.endsWith(".invalid")
}

/**
 * Send an email through the given transport.
 *
 * A message to a `.invalid` address is skipped and logged, never handed to
 * the transport. The placeholder holds only a user id, so logging it
 * discloses no personal data.
 *
 * This used to write `info.message` — the entire serialized email,
 * verification and password-reset links included — to stdout via `console.log`,
 * outside Pino's redaction. The body stays out of the log.
 *
 * The dev transport still needs *some* signal that mail was produced, so the
 * envelope is logged and the body is not. Real SMTP errors propagate to the
 * caller, which sanitizes them before they reach a client.
 */
export async function sendMail(
	transporter: Transporter,
	from: string,
	message: MailMessage
): Promise<void> {
	if (isUndeliverableAddress(message.to)) {
		// eslint-disable-next-line no-console -- same channel as the dev-transport notice below
		console.warn(
			`[mailer] skipped undeliverable address to=${message.to} subject=${JSON.stringify(
				message.subject
			)}`
		)
		return
	}

	const info = await transporter.sendMail({
		from,
		to: message.to,
		subject: message.subject,
		html: message.html,
		text: message.text,
		attachments: message.attachments,
	})

	// `info.message` is only a string on the dev (`jsonTransport`) transport.
	// Its presence is how we know mail was serialized rather than sent — the
	// value itself is the credential-bearing payload and is never read.
	if (typeof info?.message === "string") {
		// eslint-disable-next-line no-console -- dev transport announces that mail was serialized, not sent
		console.log(
			`[mailer-dev] serialized (not sent) to=${message.to} subject=${JSON.stringify(
				message.subject
			)} — body and links withheld`
		)
	}
}
