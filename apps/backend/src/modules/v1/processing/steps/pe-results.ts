import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

import { ORPCError } from "@orpc/server"
import { and, asc, desc, eq, inArray } from "drizzle-orm"

import { bookingItems, formFields, services, serviceSteps, stepResults } from "@repo/db/schema"

import type { StepExecutor } from "./item-steps"

export const PE_SERVICE_CODE = "PHYSICAL-EXAM"
export const PE_DOCUMENT_TYPE = "pe-medical-certificate"

const STEP_NAMES = ["Laboratory", "X-ray", "Physician evaluation"] as const
const SCHEME = "qsps-pe-step-result-v1"
const ALGORITHM = "aes-256-gcm"

interface PeResultIdentity {
	bookingItemId: number
	serviceStepId: number
	formTemplateId: number
	version: number
}

function readKey(): Buffer {
	const value = process.env.PE_RESULTS_ENCRYPTION_KEY
	if (!value || !/^[\da-fA-F]{64}$/.test(value)) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Physical Examination result storage is unavailable",
		})
	}
	return Buffer.from(value, "hex")
}

function associatedData(identity: PeResultIdentity): Buffer {
	return Buffer.from(JSON.stringify([
		SCHEME, identity.bookingItemId, identity.serviceStepId,
		identity.formTemplateId, identity.version,
	]))
}

export function encryptPeAnswers(answers: Record<string, unknown>, identity: PeResultIdentity) {
	const nonce = randomBytes(12)
	const cipher = createCipheriv(ALGORITHM, readKey(), nonce)
	cipher.setAAD(associatedData(identity))
	const data = Buffer.concat([cipher.update(JSON.stringify(answers), "utf8"), cipher.final()])
	return {
		scheme: SCHEME,
		nonce: nonce.toString("base64"),
		tag: cipher.getAuthTag().toString("base64"),
		ciphertext: data.toString("base64"),
	}
}

export function decryptPeAnswers(stored: Record<string, unknown>, identity: PeResultIdentity) {
	try {
		const { scheme, nonce, tag, ciphertext } = stored
		if (
			scheme !== SCHEME || typeof nonce !== "string" ||
			typeof tag !== "string" || typeof ciphertext !== "string"
		) throw new Error("Invalid envelope")

		const iv = Buffer.from(nonce, "base64")
		const authTag = Buffer.from(tag, "base64")
		if (iv.length !== 12 || authTag.length !== 16) throw new Error("Invalid envelope")

		const decipher = createDecipheriv(ALGORITHM, readKey(), iv, { authTagLength: 16 })
		decipher.setAAD(associatedData(identity))
		decipher.setAuthTag(authTag)
		const decoded: unknown = JSON.parse(Buffer.concat([
			decipher.update(Buffer.from(ciphertext, "base64")), decipher.final(),
		]).toString("utf8"))
		if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
			throw new Error("Invalid answers")
		}
		return decoded as Record<string, unknown>
	} catch {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Physical Examination results could not be read",
		})
	}
}

export async function isPeItem(executor: StepExecutor, bookingItemId: number) {
	const [row] = await executor
		.select({ code: services.code })
		.from(bookingItems)
		.innerJoin(services, eq(services.id, bookingItems.serviceId))
		.where(eq(bookingItems.id, bookingItemId))
		.limit(1)
	return row?.code === PE_SERVICE_CODE
}

export async function latestPeResults(executor: StepExecutor, bookingItemId: number) {
	const rows = await executor
		.select({
			id: stepResults.id,
			bookingItemId: stepResults.bookingItemId,
			serviceStepId: stepResults.serviceStepId,
			formTemplateId: stepResults.formTemplateId,
			version: stepResults.version,
			answers: stepResults.answers,
			recordedBy: stepResults.recordedBy,
			releasedAt: stepResults.releasedAt,
			stepName: serviceSteps.name,
		})
		.from(stepResults)
		.innerJoin(serviceSteps, eq(serviceSteps.id, stepResults.serviceStepId))
		.innerJoin(bookingItems, eq(bookingItems.id, stepResults.bookingItemId))
		.where(and(
			eq(stepResults.bookingItemId, bookingItemId),
			eq(serviceSteps.serviceId, bookingItems.serviceId),
			eq(serviceSteps.isActive, true),
			eq(serviceSteps.required, true),
			inArray(serviceSteps.name, [...STEP_NAMES])
		))
		.orderBy(asc(serviceSteps.position), desc(stepResults.version), desc(stepResults.id))

	const byName = new Map<string, (typeof rows)[number]>()
	for (const row of rows) {
		const existing = byName.get(row.stepName)
		if (existing && existing.serviceStepId !== row.serviceStepId) {
			throw new ORPCError("CONFLICT", {
				message: "Physical Examination Steps are configured more than once",
			})
		}
		if (!existing) byName.set(row.stepName, row)
	}
	return STEP_NAMES.flatMap(name => {
		const row = byName.get(name)
		return row ? [row] : []
	})
}

export async function peEvaluation(executor: StepExecutor, bookingItemId: number) {
	const results = await latestPeResults(executor, bookingItemId)
	const result = results.find(row => row.stepName === "Physician evaluation")
	if (!result || results.length !== STEP_NAMES.length) {
		throw new ORPCError("CONFLICT", {
			message: "Complete all three Physical Examination results first",
		})
	}

	const [field] = await executor
		.select({ id: formFields.id })
		.from(formFields)
		.where(and(
			eq(formFields.formTemplateId, result.formTemplateId),
			eq(formFields.type, "single_choice"),
			eq(formFields.label, "Evaluation")
		))
		.limit(1)

	const answers = decryptPeAnswers(result.answers, result)
	const outcome = field ? answers[String(field.id)] : null
	if (outcome !== "Fit" && outcome !== "Unfit" && outcome !== "Pending") {
		throw new ORPCError("CONFLICT", {
			message: "Record a valid Physician evaluation first",
		})
	}
	return { outcome, recordedBy: result.recordedBy, results }
}
