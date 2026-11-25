import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, desc, eq } from "drizzle-orm"

import { checkFormAnswers, type ProcessingItem, type RecordStepResultInput } from "@repo/contracts"
import {
	bookingItems,
	bookings,
	formTemplates,
	locations,
	services,
	serviceSteps,
	stepResults,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { PdfService } from "@/common/pdf/pdf.service"
import { NATIONWIDE_SCOPE, type ResolvedScope } from "@/common/scope/scope-match"

import { BookingService } from "../../bookings/bookings.service"
import { manilaDateOf } from "../../schedules/manila-time"
import { ProcessingService } from "../processing.service"
import { fieldsByTemplate, publishedStepForms, readableStepAnswers } from "./item-steps"
import { decryptPeAnswers, encryptPeAnswers, PE_SERVICE_CODE } from "./pe-results"

const AUDIT_DOMAIN_PROCESSING = "processing"

/**
 * When a station may record a result (Sir Sean, 24 Nov): as soon as the client
 * is checked in, and while the item is being assessed. The first result on a
 * checked-in item moves it to `in_assessment`, so the officer need not open it.
 */
const RECORDABLE_STATUSES = ["checked_in", "in_assessment"] as const

/** The same answer for a missing step, a step of another Service and a disabled one. */
function stepNotFound() {
	return new ORPCError("NOT_FOUND", { message: "Step not found for this booking item" })
}

/** A printable step result (PRC-4). */
export interface StepResultPdf {
	fileName: string
	pdf: Buffer
}

/** "2026-11-24T06:05:00Z" → "November 24, 2026, 2:05 PM" in Manila time. */
function manilaDateTime(value: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Manila",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(value)
}

/**
 * PRC-4: the result each Service Step records for a Booking Item.
 *
 * Results are insert-only: recording a step that already has a result is a
 * correction, stored as the next version with the earlier ones kept, and
 * audited with the previous and new answers. Same access rules as recording
 * an Assessment (PRC-1, ADM-2): the item must be in the caller's Scope and at
 * their station, or the caller gets a 404 and the attempt is audited.
 */
@Injectable()
export class StepResultsService {
	constructor(
		private readonly processingService: ProcessingService,
		private readonly auditService: AuditService,
		private readonly pdfService: PdfService,
		private readonly bookingService: BookingService
	) {}

	async record(
		input: RecordStepResultInput,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE,
		now: Date = new Date()
	): Promise<ProcessingItem> {
		const staffId = requireActor(actorId)
		await this.processingService.requireItemInScope(
			input.bookingItemId,
			staffId,
			"step_result.record",
			scope
		)

		await db.transaction(async tx => {
			// Locked so two officers recording the same step get versions one after the other.
			const [item] = await tx
				.select({ status: bookingItems.status, serviceId: bookingItems.serviceId, serviceCode: services.code })
				.from(bookingItems)
				.innerJoin(services, eq(services.id, bookingItems.serviceId))
				.where(eq(bookingItems.id, input.bookingItemId))
				.for("update", { of: bookingItems })
			if (!item) throw stepNotFound()
			if (!(RECORDABLE_STATUSES as readonly string[]).includes(item.status)) {
				throw new ORPCError("CONFLICT", {
					message:
						"Step results can be recorded once the client is checked in, until the item is cleared, returned or rejected",
				})
			}

			const [step] = await tx
				.select({ id: serviceSteps.id, name: serviceSteps.name })
				.from(serviceSteps)
				.where(
					and(
						eq(serviceSteps.id, input.stepId),
						eq(serviceSteps.serviceId, item.serviceId),
						eq(serviceSteps.isActive, true)
					)
				)
				.limit(1)
			if (!step) throw stepNotFound()

			const form = (await publishedStepForms(tx, [step.id])).get(step.id)
			if (!form) throw stepNotFound()
			if (form.formTemplateId !== input.formTemplateId) {
				throw new ORPCError("BAD_REQUEST", {
					message: `The result form for ${step.name} was changed. Fill it in again.`,
					data: { formChanged: true },
				})
			}

			const fields = (await fieldsByTemplate(tx, [form.formTemplateId])).get(form.formTemplateId)
			const check = checkFormAnswers(fields ?? [], input.answers)
			if (!check.ok) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Some answers for ${step.name} need fixing.`,
					data: { fieldErrors: check.fieldErrors },
				})
			}

			// The first result recorded at a station starts the assessment, through
			// BookingService like every other item status change.
			if (item.status === "checked_in") {
				await this.bookingService.transitionItem(tx, input.bookingItemId, "in_assessment", {
					actorId: staffId,
					allowedFrom: ["checked_in"],
					now,
				})
			}

			const [previous] = await tx
				.select({
					version: stepResults.version,
					formTemplateId: stepResults.formTemplateId,
					answers: stepResults.answers,
				})
				.from(stepResults)
				.where(
					and(
						eq(stepResults.bookingItemId, input.bookingItemId),
						eq(stepResults.serviceStepId, step.id)
					)
				)
				.orderBy(desc(stepResults.version))
				.limit(1)
			const version = (previous?.version ?? 0) + 1
			const isPhysicalExamination = item.serviceCode === PE_SERVICE_CODE
			const storedAnswers = isPhysicalExamination
				? encryptPeAnswers(check.answers, {
						bookingItemId: input.bookingItemId,
						serviceStepId: step.id,
						formTemplateId: form.formTemplateId,
						version,
					})
				: check.answers

			const [saved] = await tx
				.insert(stepResults)
				.values({
					bookingItemId: input.bookingItemId,
					serviceStepId: step.id,
					formTemplateId: form.formTemplateId,
					version,
					answers: storedAnswers,
					recordedBy: staffId,
					// Set here, in UTC, rather than by the database clock (DOMAIN-MODEL.md: timestamps are UTC).
					createdAt: now,
				})
				.returning({ id: stepResults.id })
			if (!saved) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The result could not be saved" })
			}

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_PROCESSING,
					action: previous ? "step_result.correct" : "step_result.record",
					actorId: staffId,
					targetType: "booking_item",
					targetId: String(input.bookingItemId),
					oldValue: previous
						? {
								stepId: step.id,
								version: previous.version,
								formTemplateId: previous.formTemplateId,
								...(isPhysicalExamination ? {} : { answers: previous.answers }),
							}
						: null,
					newValue: {
						stepResultId: saved.id,
						stepId: step.id,
						stepName: step.name,
						version,
						formTemplateId: form.formTemplateId,
						...(isPhysicalExamination ? {} : { answers: check.answers }),
					},
				},
				tx
			)
		})

		return this.processingService.loadItem(input.bookingItemId)
	}

	/**
	 * A printable copy of one step's result: the current one, or `version`
	 * when given. Same Scope rule as reading the item (no station needed).
	 * Every print is audited as `step_result.print`, like FRM-2c's downloads.
	 * Called from a plain route, so it throws oRPC errors that the controller
	 * converts.
	 */
	async resultPdf(
		bookingItemId: number,
		stepId: number,
		version: number | null,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<StepResultPdf> {
		const staffId = requireActor(actorId)
		await this.processingService.requireItemInScope(
			bookingItemId,
			staffId,
			"step_result.print",
			scope,
			{ requireStation: false }
		)

		const [item] = await db
			.select({
				referenceNumber: bookings.referenceNumber,
				clientName: users.name,
				serviceName: services.name,
				serviceCode: services.code,
				locationName: locations.name,
				serviceId: bookingItems.serviceId,
			})
			.from(bookingItems)
			.innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
			.innerJoin(users, eq(users.id, bookings.clientId))
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.innerJoin(locations, eq(locations.id, bookingItems.locationId))
			.where(eq(bookingItems.id, bookingItemId))
			.limit(1)
		const [step] = item
			? await db
					.select({ id: serviceSteps.id, name: serviceSteps.name })
					.from(serviceSteps)
					.where(and(eq(serviceSteps.id, stepId), eq(serviceSteps.serviceId, item.serviceId)))
					.limit(1)
			: []
		if (!item || !step) throw stepNotFound()

		const [result] = await db
			.select({
				version: stepResults.version,
				formTemplateId: stepResults.formTemplateId,
				answers: stepResults.answers,
				recordedByName: users.name,
				createdAt: stepResults.createdAt,
			})
			.from(stepResults)
			.innerJoin(users, eq(users.id, stepResults.recordedBy))
			.where(
				and(
					eq(stepResults.bookingItemId, bookingItemId),
					eq(stepResults.serviceStepId, step.id),
					...(version === null ? [] : [eq(stepResults.version, version)])
				)
			)
			.orderBy(desc(stepResults.version))
			.limit(1)
		if (!result) {
			throw new ORPCError("NOT_FOUND", { message: `No result is recorded for ${step.name}` })
		}

		const [form] = await db
			.select({ version: formTemplates.version })
			.from(formTemplates)
			.where(eq(formTemplates.id, result.formTemplateId))
			.limit(1)
		const fields = (await fieldsByTemplate(db, [result.formTemplateId])).get(result.formTemplateId)
		const values = item.serviceCode === PE_SERVICE_CODE
			? decryptPeAnswers(result.answers, {
					bookingItemId,
					serviceStepId: step.id,
					formTemplateId: result.formTemplateId,
					version: result.version,
				})
			: result.answers
		const answers = readableStepAnswers(fields ?? [], values)

		const pdf = await this.pdfService.render(
			{ title: `${step.name} result ${item.referenceNumber}` },
			doc => {
				const left = doc.page.margins.left
				const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
				doc.font("Helvetica-Bold").fontSize(16).fillColor("#000000").text(`${step.name} result`)
				doc
					.font("Helvetica")
					.fontSize(9)
					.fillColor("#555555")
					.text("Bureau of Quarantine, Republic of the Philippines")
				doc.moveDown(1)

				const row = (label: string, value: string) => {
					const y = doc.y
					doc
						.font("Helvetica")
						.fontSize(9)
						.fillColor("#555555")
						.text(label, left, y, { width: 150 })
					doc
						.font("Helvetica-Bold")
						.fontSize(10)
						.fillColor("#000000")
						.text(value, left + 160, y, { width: width - 160 })
					doc.moveDown(0.4)
				}
				row("Reference number", item.referenceNumber)
				row("Client", item.clientName)
				row("Service", item.serviceName)
				row("Location", item.locationName)
				row("Step", step.name)
				row(
					"Result version",
					result.version === 1 ? "1 (first result)" : `${result.version} (correction)`
				)
				row("Recorded by", result.recordedByName)
				row("Recorded at", `${manilaDateTime(result.createdAt)} (Manila time)`)
				if (form) row("Form version", String(form.version))

				doc.moveDown(0.6)
				doc
					.moveTo(left, doc.y)
					.lineTo(left + width, doc.y)
					.lineWidth(0.7)
					.strokeColor("#cccccc")
					.stroke()
				doc.moveDown(0.8)
				doc.font("Helvetica-Bold").fontSize(9).fillColor("#555555").text("RESULT", left)
				doc.moveDown(0.4)
				for (const [label, value] of Object.entries(answers)) row(label, value)
			}
		)

		// A lab or X-ray result is personal health data: every print is recorded.
		await this.auditService.record({
			domain: AUDIT_DOMAIN_PROCESSING,
			action: "step_result.print",
			actorId: staffId,
			targetType: "booking_item",
			targetId: String(bookingItemId),
			oldValue: null,
			newValue: { stepId: step.id, stepName: step.name, version: result.version },
		})

		return {
			fileName: `${item.referenceNumber}-${slug(step.name)}-v${result.version}-${manilaDateOf(result.createdAt)}.pdf`,
			pdf,
		}
	}
}

/** "Physician evaluation" → "physician-evaluation", for file names. */
function slug(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "step"
	)
}

function requireActor(actorId: string | null): string {
	if (!actorId) {
		throw new ORPCError("UNAUTHORIZED", { message: "Sign in to use processing" })
	}
	return actorId
}
