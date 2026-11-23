import type { ProcessingItem } from "@repo/contracts"

/**
 * Whether making this item cleared issues its document at once (CRT-1,
 * CRT-1a): the Service auto-issues and has a document type. The officer's
 * Clear only does so when no head approval is needed; an approval or an
 * override always does. The fields themselves are CRT-3's
 * `DocumentDetailsFields` (vaccination details or medical exemption).
 */
export function issuesDocument(item: ProcessingItem): boolean {
	return item.service.autoIssue && item.service.documentType !== null
}
