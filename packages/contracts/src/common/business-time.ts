/**
 * The business timezone for QSPS (PRD, non-functional requirements).
 *
 * Every schedule, cutoff and report is computed in this zone. Timestamps are
 * stored in UTC; convert at the edge with this constant, never with the
 * server's or the browser's local zone, which can differ from Manila.
 */
export const BUSINESS_TIMEZONE = "Asia/Manila" as const

export type BusinessTimezone = typeof BUSINESS_TIMEZONE