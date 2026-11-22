import {
	BadRequestException,
	Body,
	Controller,
	Get,
	HttpCode,
	Post,
	Put,
	Req,
	UnauthorizedException,
} from "@nestjs/common"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"
import { fromNodeHeaders } from "better-auth/node"
import type { Request } from "express"
import { z } from "zod"

import { getAuth } from "@repo/auth"

import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"

import { MeSmsService } from "./me-sms.service"

function userId(session?: UserSession): string {
	if (!session?.user?.id) throw new UnauthorizedException("Authentication required")
	return session.user.id
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
	const result = schema.safeParse(body)
	if (!result.success) throw new BadRequestException("Invalid SMS settings request")
	return result.data
}

@Controller("v1/me/sms")
@RequirePermissions("account.profile:manage")
export class MeSmsController {
	constructor(private readonly sms: MeSmsService) {}

	@Get()
	get(@Session() session?: UserSession) {
		return this.sms.get(userId(session))
	}

	@Post("request-code")
	@HttpCode(200)
	@StrictThrottle()
	request(@Body() body: unknown, @Session() session?: UserSession) {
		const input = parse(z.object({ mobile: z.string().min(10).max(30) }), body)
		return this.sms.requestCode(userId(session), input.mobile)
	}

	@Post("verify-code")
	@HttpCode(200)
	@StrictThrottle()
	verify(@Body() body: unknown, @Session() session?: UserSession) {
		const input = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), body)
		return this.sms.verifyCode(userId(session), input.code)
	}

	@Put("preferences")
	@StrictThrottle()
	async preferences(
		@Body() body: unknown,
		@Req() request: Request,
		@Session() session?: UserSession
	) {
		const input = parse(
			z.object({
				smsNotificationsEnabled: z.boolean(),
				mfaOtpChannel: z.enum(["email", "sms"]),
				password: z.string().max(256).optional(),
			}),
			body
		)
		const id = userId(session)
		const current = await this.sms.get(id)
		let confirmed = false
		if (input.mfaOtpChannel !== current.mfaOtpChannel) {
			if (!input.password) throw new BadRequestException("Confirm your password")
			try {
				const result = await getAuth().api.verifyPassword({
					headers: fromNodeHeaders(request.headers),
					body: { password: input.password },
				})
				confirmed = result.status === true
			} catch {
				throw new BadRequestException("Could not confirm your password")
			}
		}
		return this.sms.updatePreferences(
			id,
			{
				smsNotificationsEnabled: input.smsNotificationsEnabled,
				mfaOtpChannel: input.mfaOtpChannel,
			},
			confirmed
		)
	}
}
