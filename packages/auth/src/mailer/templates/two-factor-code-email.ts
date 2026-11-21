/**
 * The emailed one-time sign-in code (AUTH-2). Same layout as the other auth
 * emails; the code is shown large so it can be typed from a phone.
 */
export function buildTwoFactorCodeEmail(opts: { code: string; minutes: number }): {
	subject: string
	html: string
	text: string
} {
	const { code, minutes } = opts

	const subject = `Your QSPS sign-in code: ${code}`

	const html = `<!doctype html>
<html>
	<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
			<tr>
				<td align="center">
					<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;padding:32px;border-top:4px solid #f5c542;">
						<tr>
							<td style="color:#0a2540;font-size:20px;font-weight:bold;padding-bottom:16px;">
								Your sign-in code
							</td>
						</tr>
						<tr>
							<td style="color:#3f3f46;font-size:14px;line-height:22px;padding-bottom:20px;">
								Use this code to finish signing in to QSPS, the Bureau of Quarantine's online services.
							</td>
						</tr>
						<tr>
							<td style="padding-bottom:20px;">
								<div style="display:inline-block;background-color:#0a2540;color:#ffffff;font-size:28px;font-weight:bold;letter-spacing:8px;padding:14px 22px;border-radius:8px;font-family:'Courier New',monospace;">
									${code}
								</div>
							</td>
						</tr>
						<tr>
							<td style="color:#71717a;font-size:12px;line-height:20px;">
								The code expires in ${minutes} minutes and works once. If you did not try to sign in, change your password now: someone may know it.
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>`

	const text = `Your QSPS sign-in code: ${code}

Use this code to finish signing in to QSPS, the Bureau of Quarantine's online services.

The code expires in ${minutes} minutes and works once. If you did not try to sign in, change your password now: someone may know it.`

	return { subject, html, text }
}
