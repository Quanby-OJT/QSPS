import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { IssuedDocumentPanel } from "./document-panels"

const mocks = vi.hoisted(() => ({ revoke: vi.fn(), reissue: vi.fn() }))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/features/processing/api/processing.hooks", () => ({
	useIssueDocumentMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
	usePrintDocumentMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useRevokeDocumentMutation: () => ({ mutateAsync: mocks.revoke, isPending: false }),
	useReissueDocumentMutation: () => ({ mutateAsync: mocks.reissue, isPending: false }),
}))

const item = {
	bookingItemId: 44,
	document: {
		id: 9,
		documentType: "icv-record",
		documentNumber: "ICV-MNL-2026-000008",
		printCount: 0,
	},
} as never

describe("Revoke and reissue on the issued document (CRT-8)", () => {
	beforeEach(() => {
		mocks.revoke.mockReset().mockResolvedValue({ documentNumber: "ICV-MNL-2026-000008" })
		mocks.reissue.mockReset().mockResolvedValue({ documentNumber: "ICV-MNL-2026-000009" })
	})

	it("shows Revoke and Reissue only to staff with the key", () => {
		const { rerender } = render(<IssuedDocumentPanel item={item} canPrint={false} />)
		expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument()

		rerender(<IssuedDocumentPanel item={item} canPrint={false} canRevoke />)
		expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Reissue with corrections" })).toBeInTheDocument()
	})

	it("needs a reason before revoking", async () => {
		const user = userEvent.setup()
		render(<IssuedDocumentPanel item={item} canPrint={false} canRevoke />)

		await user.click(screen.getByRole("button", { name: "Revoke" }))
		const confirm = screen.getByRole("button", { name: "Revoke document" })
		expect(confirm).toBeDisabled()

		await user.type(screen.getByLabelText("Reason *"), "Wrong batch number")
		await user.click(confirm)

		expect(mocks.revoke).toHaveBeenCalledWith({ documentId: 9, reason: "Wrong batch number" })
	})

	it("reissues with the corrected vaccination details and the reason", async () => {
		const user = userEvent.setup()
		render(<IssuedDocumentPanel item={item} canPrint={false} canRevoke />)

		await user.click(screen.getByRole("button", { name: "Reissue with corrections" }))
		await user.type(screen.getByLabelText("Batch/lot number *"), "YF-25B")
		await user.type(screen.getByLabelText("Vaccinator *"), "Dr. Juan Reyes")
		await user.type(screen.getByLabelText("Reason *"), "Wrong batch number")
		await user.click(screen.getByRole("button", { name: "Reissue document" }))

		expect(mocks.reissue).toHaveBeenCalledWith(
			expect.objectContaining({
				documentId: 9,
				reason: "Wrong batch number",
				details: expect.objectContaining({
					batchNumber: "YF-25B",
					vaccinatorName: "Dr. Juan Reyes",
				}),
				exemption: null,
			})
		)
	})
})
