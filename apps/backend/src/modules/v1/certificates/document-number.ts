import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

/**
 * A Document Number: `{PREFIX}-{LOCATION}-{YYYY}-{NNNNNN}`, e.g. ICV-MNL-2026-000001.
 *
 * Per Sir Sean (CRT-1): numbered per document type and Location. YYYY is the
 * issue year in Asia/Manila, but the counter does not reset each year:
 * `document_sequences` has no year, so January continues from December. If
 * BOQ later wants a yearly reset, a year is added to the sequence then.
 */
export function formatDocumentNumber(
	prefix: string,
	locationCode: string,
	issuedAt: Date,
	sequence: number
): string {
	const year = manilaDateOf(issuedAt).slice(0, 4)
	return `${prefix}-${locationCode.toUpperCase()}-${year}-${String(sequence).padStart(6, "0")}`
}
