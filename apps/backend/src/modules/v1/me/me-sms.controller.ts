import { Controller, Req } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement, ORPCError } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"
import { fromNodeHeaders } from "better-auth/node"
import type { Request } from "express"

import { getAuth } from "@repo/auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"

import { MeSmsService } from "./me-sms.service"

/** The signed-in user id, or an oRPC 401 (Nest exceptions become 500s inside oRPC). */
function requireUserId(session?: UserSession): string {
	const userId = session?.user?.id
	if (!userId) throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" })
	return userId
}

/**
 * Mobile number and SMS settings (NTF-2). Every route needs
 * `account.profile:manage`; the record is always the caller's own.
 */
@Controller()
export class MeSmsController {
	constructor(private readonly sms: MeSmsService) {}

	@RequirePermissions("account.profile:manage")
	@Implement(v1.me.smsSettings)
	async settings(@Session() session?: UserSession) {
		return implement(v1.me.smsSettings).handler(() => this.sms.get(requireUserId(session)))
	}

	@RequirePermissions("account.profile:manage")
	@StrictThrottle()
	@Implement(v1.me.requestSmsCode)
	async requestCode(@Session() session?: UserSession) {
		return implement(v1.me.requestSmsCode).handler(({ input }) =>
			this.sms.requestCode(requireUserId(session), input.mobile)
		)
	}

	@RequirePermissions("account.profile:manage")
	@StrictThrottle()
	@Implement(v1.me.verifySmsCode)
	async verifyCode(@Session() session?: UserSession) {
		return implement(v1.me.verifySmsCode).handler(({ input }) =>
			this.sms.verifyCode(requireUserId(session), input.code)
		)
	}

	@RequirePermissions("account.profile:manage")
	@StrictThrottle()
	@Implement(v1.me.updateSmsPreferences)
	async updatePreferences(@Req() request: Request, @Session() session?: UserSession) {
		return implement(v1.me.updateSmsPreferences).handler(async ({ input }) => {
			const userId = requireUserId(session)
			const current = await this.sms.get(userId)
			let confirmed = false
			if (input.mfaOtpChannel !== current.mfaOtpChannel) {
				if (!input.password) {
					throw new ORPCError("BAD_REQUEST", { message: "Confirm your password" })
				}
				try {
					const result = await getAuth().api.verifyPassword({
						headers: fromNodeHeaders(request.headers),
						body: { password: input.password },
					})
					confirmed = result.status === true
				} catch {
					throw new ORPCError("BAD_REQUEST", { message: "Your password is incorrect" })
				}
			}
			return this.sms.updatePreferences(
				userId,
				{
					smsNotificationsEnabled: input.smsNotificationsEnabled,
					mfaOtpChannel: input.mfaOtpChannel,
				},
				confirmed
			)
		})
	}
}
