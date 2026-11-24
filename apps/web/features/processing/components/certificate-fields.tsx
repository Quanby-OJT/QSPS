import type { ProcessingItem } from "@repo/contracts"

/**
 * Whether making this item cleared issues its document at once (CRT-1,
 * CRT-1a): the Service auto-issues the vaccination record. The officer's
 * Clear only does so when no head approval is needed; an approval or an
 * override always does. The fields themselves are CRT-3's
 * `DocumentDetailsFields` (vaccination details or medical exemption).
 *
 * CRT-5: a sanitation Service never issues on clearing; the officer issues
 * its permit or certificate from the item (`IssueDocumentPanel`), because the
 * validity period is entered then.
 */
export function issuesDocument(item: ProcessingItem): boolean {
	return item.service.autoIssue && item.service.documentType === "icv-record"
}
