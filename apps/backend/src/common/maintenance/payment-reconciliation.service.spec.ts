import { PaymentReconciliationService } from "./payment-reconciliation.service"

jest.mock("@/modules/v1/payments/payments.service", () => ({
	PaymentService: jest.fn(),
}))

describe("PaymentReconciliationService (PAY-6)", () => {
	const result = { checked: 2, confirmed: 1, closed: 1, stillPending: 0, amountMismatch: 0, failed: 0 }

	it("runs the payment service's re-query", async () => {
		const paymentService = { reconcilePending: jest.fn().mockResolvedValue(result) }
		const job = new PaymentReconciliationService(paymentService as never)
		const now = new Date("2026-11-24T03:00:00.000Z")

		await expect(job.reconcile(now)).resolves.toEqual(result)
		expect(paymentService.reconcilePending).toHaveBeenCalledWith(now)
	})

	it("logs instead of throwing when a run fails, so the cron keeps going", async () => {
		const paymentService = { reconcilePending: jest.fn().mockRejectedValue(new Error("database down")) }
		const job = new PaymentReconciliationService(paymentService as never)

		await expect(job.run()).resolves.toBeUndefined()
	})
})
