import type { IcvIssueDetails } from "@repo/contracts"

import type { DocumentTypeDefinition, RenderableDocumentType } from "./document-type"
import { icvRecord } from "./icv-record"
import { medicalExemption } from "./medical-exemption"

/**
 * Every document type QSPS can issue (CRT-1). A document's `document_type`
 * must be a key here. Later types (CRT-5 to CRT-10) add one line each.
 */
const REGISTRY: Record<string, RenderableDocumentType> = {
	[icvRecord.type]: icvRecord,
	// CRT-3: issued instead of the vaccination record when the client is medically exempt.
	[medicalExemption.type]: medicalExemption,
}

/**
 * The types a Service can be set to issue, with the details staff type for
 * them. A Medical Exemption is never a Service's type (CRT-3).
 */
const SERVICE_TYPES: Record<string, DocumentTypeDefinition<IcvIssueDetails>> = {
	[icvRecord.type]: icvRecord,
}

/**
 * Service types whose clients may be issued a Medical Exemption instead
 * (CRT-3). Same list as `VACCINATION_DOCUMENT_TYPES` in @repo/contracts, kept
 * here because backend Jest cannot load that package's runtime exports.
 */
const VACCINATION_TYPES: readonly string[] = [icvRecord.type]

export { medicalExemption }

/** The definition of an existing document's type, or undefined when QSPS cannot draw it. */
export function documentTypeFor(
	type: string | null | undefined
): RenderableDocumentType | undefined {
	return type ? REGISTRY[type] : undefined
}

/** The type a Service issues, or undefined when it issues none QSPS can generate. */
export function serviceDocumentTypeFor(
	type: string | null | undefined
): DocumentTypeDefinition<IcvIssueDetails> | undefined {
	return type ? SERVICE_TYPES[type] : undefined
}

/** Whether a Service issuing this type is a vaccination, so an exemption applies (CRT-3). */
export function isVaccinationType(type: string | null | undefined): boolean {
	return !!type && VACCINATION_TYPES.includes(type)
}
