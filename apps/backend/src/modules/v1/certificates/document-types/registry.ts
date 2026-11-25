import type { RenderableDocumentType } from "./document-type"
import { icvRecord } from "./icv-record"
import { medicalExemption } from "./medical-exemption"
import { sanitaryPermit } from "./sanitary-permit"
import { shipSanitation } from "./ship-sanitation"

/**
 * Every document type QSPS can issue (CRT-1). A document's `document_type`
 * must be a key here. Later types (CRT-6 to CRT-10) add one line each.
 */
const REGISTRY: Record<string, RenderableDocumentType> = {
	[icvRecord.type]: icvRecord,
	// CRT-3: issued instead of the vaccination record when the client is medically exempt.
	[medicalExemption.type]: medicalExemption,
	// CRT-5: issued by sanitation Services. Wording and numbering await BOQ sign-off (PRD open item 6).
	[sanitaryPermit.type]: sanitaryPermit,
	[shipSanitation.type]: shipSanitation,
}

/**
 * The types a Service can be set to issue. A Medical Exemption is never a
 * Service's type (CRT-3). Which details staff type for each is decided in
 * `DocumentService.issue`.
 */
const SERVICE_TYPES: Record<string, RenderableDocumentType> = {
	[icvRecord.type]: icvRecord,
	[sanitaryPermit.type]: sanitaryPermit,
	[shipSanitation.type]: shipSanitation,
}

/**
 * Service types whose clients may be issued a Medical Exemption instead
 * (CRT-3). Same list as `VACCINATION_DOCUMENT_TYPES` in @repo/contracts, kept
 * here because backend Jest cannot load that package's runtime exports.
 */
const VACCINATION_TYPES: readonly string[] = [icvRecord.type]

export { icvRecord, medicalExemption, sanitaryPermit, shipSanitation }

/** The definition of an existing document's type, or undefined when QSPS cannot draw it. */
export function documentTypeFor(
	type: string | null | undefined
): RenderableDocumentType | undefined {
	return type ? REGISTRY[type] : undefined
}

/** The type a Service issues, or undefined when it issues none QSPS can generate. */
export function serviceDocumentTypeFor(
	type: string | null | undefined
): RenderableDocumentType | undefined {
	return type ? SERVICE_TYPES[type] : undefined
}

/** Whether a Service issuing this type is a vaccination, so an exemption applies (CRT-3). */
export function isVaccinationType(type: string | null | undefined): boolean {
	return !!type && VACCINATION_TYPES.includes(type)
}
