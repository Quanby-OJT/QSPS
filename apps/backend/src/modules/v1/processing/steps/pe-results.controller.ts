import {
	BadRequestException,
	Body,
	Controller,
	ForbiddenException,
	Get,
	HttpException,
	NotFoundException,
	Param,
	ParseIntPipe,
	Put,
	Res,
	UnauthorizedException,
} from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"
import { and, eq, inArray } from "drizzle-orm"
import type { Response } from "express"

import { bookingItems, bookings, services, stepResults } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { PdfService } from "@/common/pdf/pdf.service"
import { ScopeService } from "@/common/scope/scope.service"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"

import { ProcessingService } from "../processing.service"
import { fieldsByTemplate, readableStepAnswers } from "./item-steps"
import { PE_SERVICE_CODE, decryptPeAnswers, latestPeResults, peEvaluation } from "./pe-results"

function actorId(session?: UserSession): string {
	const id = session?.user?.id
	if (!id) throw new UnauthorizedException("Sign in to continue")
	return id
}

async function toHttp<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run()
	} catch (error) {
		if (error instanceof ORPCError) throw new HttpException(error.message, error.status)
		throw error
	}
}

@Controller("v1")
export class PeResultsController {
	constructor(
		private readonly processing: ProcessingService,
		private readonly scope: ScopeService,
		private readonly audit: AuditService,
		private readonly pdf: PdfService
	) {}

	@RequirePermissions("processing.assessments:perform", "certificates.documents:issue")
	@Put("processing/items/:itemId/pe-results/release")
	async setRelease(
		@Param("itemId", ParseIntPipe) itemId: number,
		@Body() body: unknown,
		@Session() session?: UserSession
	) {
		const staffId = actorId(session)
		const released =
			body && typeof body === "object" && "released" in body ? body.released : undefined
		if (typeof released !== "boolean") {
			throw new BadRequestException("released must be true or false")
		}

		return toHttp(async () => {
			await this.processing.requireItemInScope(
				itemId,
				staffId,
				"pe_results.release",
				await this.scope.resolve(staffId),
				{ requireStation: false }
			)

			const evaluationOwner = await db.transaction(async tx => {
				const [item] = await tx
					.select({ id: bookingItems.id, serviceId: bookingItems.serviceId })
					.from(bookingItems)
					.where(eq(bookingItems.id, itemId))
					.for("update")

				if (!item) throw new NotFoundException("Booking item not found")
				const [service] = await tx
					.select({ code: services.code })
					.from(services)
					.where(eq(services.id, item.serviceId))
				if (service?.code !== PE_SERVICE_CODE) {
					throw new NotFoundException("Booking item not found")
				}

				const evaluation = await peEvaluation(tx, itemId)
				if (evaluation.recordedBy !== staffId) return false

				const resultIds = evaluation.results.map(row => row.id)
				const changed = evaluation.results.some(row => Boolean(row.releasedAt) !== released)
				if (!changed) return true

				await tx
					.update(stepResults)
					.set({ releasedAt: released ? new Date() : null })
					.where(and(eq(stepResults.bookingItemId, itemId), inArray(stepResults.id, resultIds)))

				await this.audit.record(
					{
						domain: "processing",
						action: released ? "pe_results.release" : "pe_results.unrelease",
						actorId: staffId,
						targetType: "booking_item",
						targetId: String(itemId),
						newValue: { released, resultIds },
					},
					tx
				)
				return true
			})

			if (!evaluationOwner) {
				await this.audit.record({
					domain: "processing",
					action: "pe_results.release",
					outcome: "denied",
					actorId: staffId,
					targetType: "booking_item",
					targetId: String(itemId),
					reason: "not_evaluation_author",
				})
				throw new ForbiddenException("Only the staff member who recorded the evaluation can release it")
			}
			return { released }
		})
	}

	@RequirePermissions("bookings.own:read")
	@Get("bookings/items/:itemId/pe-results")
	async availability(
		@Param("itemId", ParseIntPipe) itemId: number,
		@Res({ passthrough: true }) response: Response,
		@Session() session?: UserSession
	) {
		response.setHeader("Cache-Control", "private, no-store")
		return toHttp(async () => {
			const snapshot = await this.ownerSnapshot(itemId, actorId(session), false)
			return { released: snapshot.released }
		})
	}

	@RequirePermissions("bookings.own:read")
	@Get("bookings/items/:itemId/pe-results/summary.pdf")
	async download(
		@Param("itemId", ParseIntPipe) itemId: number,
		@Res() response: Response,
		@Session() session?: UserSession
	) {
		const clientId = actorId(session)
		return toHttp(async () => {
			const snapshot = await this.ownerSnapshot(itemId, clientId, true)
			if (!snapshot.released) throw new NotFoundException("Results summary is unavailable")

			const data = await this.pdf.render({ title: "Physical Examination results summary" }, doc => {
				doc.font("Helvetica-Bold").fontSize(17).text("Physical Examination results summary")
				doc.moveDown().font("Helvetica").fontSize(11).text(`Booking: ${snapshot.reference}`)
				for (const section of snapshot.sections) {
					doc.moveDown().font("Helvetica-Bold").text(section.name)
					doc.font("Helvetica")
					for (const [label, value] of Object.entries(section.answers)) {
						doc.text(`${label}: ${value}`)
					}
				}
			})

			await this.audit.record({
				domain: "processing",
				action: "pe_results.download",
				actorId: clientId,
				targetType: "booking_item",
				targetId: String(itemId),
			})
			response.setHeader("Cache-Control", "private, no-store")
			response.setHeader("Content-Type", "application/pdf")
			response.setHeader("Content-Disposition", 'attachment; filename="physical-examination-results.pdf"')
			response.end(data)
		})
	}

	private async ownerSnapshot(itemId: number, clientId: string, includeAnswers: boolean) {
		return db.transaction(async tx => {
			const [item] = await tx
				.select({ id: bookingItems.id, reference: bookings.referenceNumber })
				.from(bookingItems)
				.innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
				.innerJoin(services, eq(services.id, bookingItems.serviceId))
				.where(
					and(
						eq(bookingItems.id, itemId),
						eq(bookings.clientId, clientId),
						eq(services.code, PE_SERVICE_CODE)
					)
				)
				.for("update", { of: bookingItems })

			if (!item) throw new NotFoundException("Results summary is unavailable")

			const results = await latestPeResults(tx, itemId)
			const released = results.length === 3 && results.every(row => row.releasedAt !== null)
			if (!released || !includeAnswers) {
				return { released, reference: item.reference, sections: [] }
			}

			const fields = await fieldsByTemplate(tx, results.map(row => row.formTemplateId))
			return {
				released,
				reference: item.reference,
				sections: results.map(row => ({
					name: row.stepName,
					answers: readableStepAnswers(
						fields.get(row.formTemplateId) ?? [],
						decryptPeAnswers(row.answers, row)
					),
				})),
			}
		})
	}
}
