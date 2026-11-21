/**
 * Sent to the account owner when repeated failed sign-ins lock the account
 * (AUTH-3). Says what happened and what to do; no link, so it cannot be
 * used as a phishing template.
 */
export function buildAccountLockedEmail(opts: { minutes: number; attempts: number }): {
	subject: string
	html: string
	text: string
} {
	const { minutes, attempts } = opts

	const subject = "Your QSPS account was locked"

	const html = `<!doctype html>
<html>
	<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
			<tr>
				<td align="center">
					<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;padding:32px;border-top:4px solid #f5c542;">
						<tr>
							<td style="color:#0a2540;font-size:20px;font-weight:bold;padding-bottom:16px;">
								Your account was locked
							</td>
						</tr>
						<tr>
							<td style="color:#3f3f46;font-size:14px;line-height:22px;padding-bottom:16px;">
								There were ${attempts} failed sign-in attempts on your QSPS account, so it is locked for ${minutes} minutes. You can sign in again after that.
							</td>
						</tr>
						<tr>
							<td style="color:#71717a;font-size:12px;line-height:20px;">
								If this was not you, someone may be trying to guess your password. After the lock ends, sign in and change your password, or use "Forgot your password?" on the sign-in page.
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>`

	const text = `Your QSPS account was locked

There were ${attempts} failed sign-in attempts on your QSPS account, so it is locked for ${minutes} minutes. You can sign in again after that.

If this was not you, someone may be trying to guess your password. After the lock ends, sign in and change your password, or use "Forgot your password?" on the sign-in page.`

	return { subject, html, text }
}