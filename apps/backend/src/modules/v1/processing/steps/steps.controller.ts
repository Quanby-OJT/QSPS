import {
	Controller,
	Get,
	HttpException,
	Inject,
	Optional,
	Param,
	ParseIntPipe,
	Query,
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
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { ServiceStepsService } from "./service-steps.service"
import { StepResultsService } from "./step-results.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

/**
 * PRC-4: Service Steps. Configuring them needs `settings.services:manage`;
 * recording a result needs `processing.assessments:perform`; printing one
 * needs `processing.queue:read`, like reading the item. RbacGuard answers 403
 * and audits the denial without the key; the services check Scope (404 and a
 * denied audit outside it).
 */
@Controller()
export class StepsController {
	constructor(
		private readonly serviceSteps: ServiceStepsService,
		private readonly stepResults: StepResultsService,
		@Optional() @Inject(SCOPE_RESOLVER) private readonly scopeResolver?: ScopeResolver
	) {}

	/** ADM-2: no resolver wired in means no Scope, so a wiring mistake fails closed. */
	private async scopeOf(session?: UserSession) {
		return this.scopeResolver ? this.scopeResolver.resolve(actorId(session)) : NO_SCOPE
	}

	@RequirePermissions("settings.services:manage")
	@Implement(v1.processing.serviceSteps)
	async list(@Session() session?: UserSession) {
		return implement(v1.processing.serviceSteps).handler(async ({ input }) =>
			this.serviceSteps.list(input.serviceId, actorId(session), await this.scopeOf(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("settings.services:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.processing.saveServiceSteps)
	async save(@Session() session?: UserSession) {
		return implement(v1.processing.saveServiceSteps).handler(async ({ input }) =>
			this.serviceSteps.save(input, actorId(session), await this.scopeOf(session))
		)
	}

	// Idempotent: a double click with the same Idempotency-Key replays the first
	// result instead of adding a correction.
	@RequirePermissions("processing.assessments:perform")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.processing.recordStepResult)
	async record(@Session() session?: UserSession) {
		return implement(v1.processing.recordStepResult).handler(async ({ input }) =>
			this.stepResults.record(input, actorId(session), await this.scopeOf(session))
		)
	}

	/**
	 * GET /api/v1/processing/items/{bookingItemId}/steps/{stepId}/result.pdf,
	 * optionally `?version=2`. A plain route because it answers with PDF bytes;
	 * shown inline so staff can print it, and never cached.
	 */
	@RequirePermissions("processing.queue:read")
	@Get("v1/processing/items/:bookingItemId/steps/:stepId/result.pdf")
	async resultPdf(
		@Param("bookingItemId", ParseIntPipe) bookingItemId: number,
		@Param("stepId", ParseIntPipe) stepId: number,
		@Res() response: Response,
		@Query("version") version?: string,
		@Session() session?: UserSession
	): Promise<void> {
		const parsedVersion = version === undefined || version === "" ? null : Number(version)
		if (parsedVersion !== null && (!Number.isInteger(parsedVersion) || parsedVersion < 1)) {
			throw new HttpException("version must be a positive whole number", 400)
		}
		let file: Awaited<ReturnType<StepResultsService["resultPdf"]>>
		try {
			file = await this.stepResults.resultPdf(
				bookingItemId,
				stepId,
				parsedVersion,
				actorId(session),
				await this.scopeOf(session)
			)
		} catch (error) {
			// The service speaks oRPC errors; this route is plain Nest.
			if (error instanceof ORPCError) throw new HttpException(error.message, error.status)
			throw error
		}
		response.setHeader("Cache-Control", "private, no-store")
		response.setHeader("Content-Type", "application/pdf")
		response.setHeader("Content-Disposition", `inline; filename="${file.fileName}"`)
		response.setHeader("Content-Length", String(file.pdf.length))
		response.end(file.pdf)
	}
}
