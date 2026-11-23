import type { BookingItemFormInput, FormAnswers } from "@repo/contracts"

import type { db } from "@/common/database/database.client"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** The database, or a transaction. */
export type FormExecutor = typeof db | Transaction

/** Checked answers, ready to store against this exact version. */
export interface PreparedSubmission {
	formTemplateId: number
	version: number
	answers: FormAnswers
}

export interface PrepareSubmissionArgs {
	serviceId: number
	serviceName: string
	/** What the client sent for this item, if anything. */
	form: BookingItemFormInput | undefined
	actorId: string
	/** Added to the error data, e.g. the scheduleSlotId the wizard needs. */
	errorData: Record<string, unknown>
}

/** What BookingService needs from the forms module (FRM-2). */
export interface FormSubmissionPreparer {
	prepare(executor: FormExecutor, args: PrepareSubmissionArgs): Promise<PreparedSubmission | null>
}

/**
 * Injection token for the `FormSubmissionPreparer`. BookingService depends on
 * this, not on the class, so it never loads the contracts barrel at runtime.
 */
export const FORM_SUBMISSIONS = Symbol("FORM_SUBMISSIONS")
