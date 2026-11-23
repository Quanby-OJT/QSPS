import {
	Controller,
	Get,
	HttpException,
	Inject,
	Optional,
	Param,
	ParseIntPipe,
	Res,
	UseInterceptors,
} from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement, ORPCError } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"
import type { Response } from "express"

import { NO_SCOPE, SCOPE_RESOLVER, type ScopeResolver } from "@/common/scope/scope.token"
import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { ProcessingService } from "./processing.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

/**
 * BOQ staff assessment (PRC-1) and head approval (PRC-3). RbacGuard checks
 * the permission key (403 and a denied Audit Entry without it);
 * ProcessingService checks Scope and the Location.
 *
 * These routes use the normal throttle, not the strict one: staff make three
 * calls per client (check in, open, assess), and every route already needs a
 * staff session and a processing permission.
 */
@Controller()
export class ProcessingController {
	constructor(
		private readonly processingService: ProcessingService,
		@Optional() @Inject(SCOPE_RESOLVER) private readonly scopeResolver?: ScopeResolver
	) {}

	/** ADM-2: the queue and item routes work inside the caller's Scope. */
	private async scopeOf(session?: UserSession) {
		return this.scopeResolver ? this.scopeResolver.resolve(actorId(session)) : NO_SCOPE
	}

	@RequirePermissions("processing.queue:read")
	@Implement(v1.processing.queue)
	async queue(@Session() session?: UserSession) {
		return implement(v1.processing.queue).handler(async ({ input }) =>
			this.processingService.queue(input, actorId(session), new Date(), await this.scopeOf(session))
		)
	}

	@RequirePermissions("processing.queue:read")
	@Implement(v1.processing.item)
	async item(@Session() session?: UserSession) {
		return implement(v1.processing.item).handler(async ({ input }) =>
			this.processingService.item(input, actorId(session), await this.scopeOf(session))
		)
	}

	/**
	 * FRM-2c: GET /api/v1/processing/items/{bookingItemId}/answers/{fieldId}/file.
	 * A plain route rather than oRPC because it answers with the file's bytes.
	 * Sent as an attachment and never cached, since it holds personal documents.
	 */
	@RequirePermissions("processing.queue:read")
	@Get("v1/processing/items/:bookingItemId/answers/:fieldId/file")
	async answerFile(
		@Param("bookingItemId", ParseIntPipe) bookingItemId: number,
		@Param("fieldId", ParseIntPipe) fieldId: number,
		@Res() response: Response,
		@Session() session?: UserSession
	): Promise<void> {
		let file: Awaited<ReturnType<ProcessingService["answerFile"]>>
		try {
			file = await this.processingService.answerFile(
				bookingItemId,
				fieldId,
				actorId(session),
				await this.scopeOf(session)
			)
		} catch (error) {
			// The service speaks oRPC errors; this route is plain Nest.
			if (error instanceof ORPCError) throw new HttpException(error.message, error.status)
			throw error
		}
		response.setHeader("Cache-Control", "private, no-store")
		response.setHeader("Content-Type", file.contentType)
		response.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`)
		response.setHeader("X-Content-Type-Options", "nosniff")
		response.setHeader("Content-Length", String(file.body.length))
		response.end(Buffer.from(file.body))
	}

	// Scanning the same QR twice is harmless: items already checked in stay as they are.
	@RequirePermissions("processing.assessments:perform")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.processing.checkIn)
	async checkIn(@Session() session?: UserSession) {
		return implement(v1.processing.checkIn).handler(({ input }) =>
			this.processingService.checkIn(input, actorId(session))
		)
	}

	@RequirePermissions("processing.assessments:perform")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.processing.open)
	async open(@Session() session?: UserSession) {
		return implement(v1.processing.open).handler(async ({ input }) =>
			this.processingService.open(input, actorId(session), await this.scopeOf(session))
		)
	}

	// Idempotent: a double click with the same Idempotency-Key replays the
	// first result instead of adding a second Assessment.
	@RequirePermissions("processing.assessments:perform")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.processing.assess)
	async assess(@Session() session?: UserSession) {
		return implement(v1.processing.assess).handler(async ({ input }) =>
			this.processingService.assess(input, actorId(session), await this.scopeOf(session))
		)
	}

	// PRC-3: head approval. Only holders of processing.assessments:approve, and
	// only for items inside their Scope.
	@RequirePermissions("processing.assessments:approve")
	@Implement(v1.processing.approvals)
	async approvals(@Session() session?: UserSession) {
		return implement(v1.processing.approvals).handler(async ({ input }) =>
			this.processingService.approvals(input, actorId(session), await this.scopeOf(session))
		)
	}

	@RequirePermissions("processing.assessments:approve")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.processing.decide)
	async decide(@Session() session?: UserSession) {
		return implement(v1.processing.decide).handler(async ({ input }) =>
			this.processingService.decide(input, actorId(session), await this.scopeOf(session))
		)
	}

	@RequirePermissions("processing.assessments:approve")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.processing.override)
	async override(@Session() session?: UserSession) {
		return implement(v1.processing.override).handler(async ({ input }) =>
			this.processingService.override(input, actorId(session), await this.scopeOf(session))
		)
	}
}
