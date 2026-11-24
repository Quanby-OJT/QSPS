import { Injectable, Logger } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"

import { PaymentService, type ReconcileResult } from "@/modules/v1/payments/payments.service"

/**
 * Re-checks payments that never reported back (PAY-6, Flow C failure
 * branch). Annex B asks for real-time status, but gateway notifications can be
 * late or lost, and over-the-counter channels such as 7-Eleven can be paid
 * hours later.
 *
 * Every 5 minutes it hands over to `PaymentService.reconcilePending`, which
 * asks each provider about Payments still `pending` after the re-query
 * interval and applies the answer through the same `confirm` path as a
 * notification. Runs beside the BKG-2 expiry job; that job waits while a
 * Payment is still being checked (the deferral rule in booking-expiry.ts).
 */
@Injectable()
export class PaymentReconciliationService {
	private readonly logger = new Logger(PaymentReconciliationService.name)

	constructor(private readonly paymentService: PaymentService) {}

	@Cron("*/5 * * * *", { name: "payment-reconciliation" })
	async run(): Promise<void> {
		// A cron callback has no caller: a throw here must be logged, not left
		// as an unhandled rejection. The next tick tries again.
		try {
			const result = await this.reconcile()
			if (result.checked || result.failed) {
				this.logger.log({ event: "payments.reconciliation", ...result })
			}
		} catch (error) {
			this.logger.error(
				"Payment reconciliation run failed",
				error instanceof Error ? error.stack : undefined
			)
		}
	}

	reconcile(now: Date = new Date()): Promise<ReconcileResult> {
		return this.paymentService.reconcilePending(now)
	}
}
