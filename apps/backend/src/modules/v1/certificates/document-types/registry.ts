import type { IcvIssueDetails } from "@repo/contracts"

import type { DocumentTypeDefinition } from "./document-type"
import { icvRecord } from "./icv-record"

/**
 * Every document type QSPS can issue (CRT-1). A Service's `document_type`
 * must be a key here. Later types (CRT-3 to CRT-10) add one line each.
 */
const REGISTRY: Record<string, DocumentTypeDefinition<IcvIssueDetails>> = {
	[icvRecord.type]: icvRecord,
}

/** The definition for a document type, or undefined when QSPS cannot issue it. */
export function documentTypeFor(
	type: string | null | undefined
): DocumentTypeDefinition<IcvIssueDetails> | undefined {
	return type ? REGISTRY[type] : undefined
}
