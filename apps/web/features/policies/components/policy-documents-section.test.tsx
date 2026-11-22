import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PolicyDocument } from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"

import { PolicyDocumentsSection } from "./policy-documents-section"

const useDocuments = vi.hoisted(() => vi.fn())
const create = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn())
const withdraw = vi.hoisted(() => vi.fn())

vi.mock("@/features/policies/api/policy-documents.hooks", () => ({
	usePolicyDocumentsQuery: useDocuments,
	useCreatePolicyDocumentMutation: () => ({ mutateAsync: create, isPending: false }),
	useUpdatePolicyDocumentMutation: () => ({ mutateAsync: update, isPending: false }),
	useWithdrawPolicyDocumentMutation: () => ({ mutateAsync: withdraw, isPending: false }),
}))

vi.mock("@/features/services/api/services.hooks", () => ({
	useAvailableServicesQuery: () => ({
		isPending: false,
		isError: false,
		data: [{ id: 2, name: "Yellow fever vaccination" }],
	}),
}))

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}))

const KEY = "3f1c2b7e-8a4d-4e5f-9b6a-0c1d2e3f4a5b"

const terms: PolicyDocument = {
	id: 4,
	documentKey: KEY,
	version: 2,
	title: "Terms of booking",
	body: "Arrive 15 minutes early.",
	requiresAcceptance: true,
	effectiveFrom: "2026-11-01",
	appliesToAllServices: true,
	serviceNames: [],
	serviceIds: [],
	state: "in_effect",
	olderVersionInEffect: false,
	withdrawnAt: null,
	createdAt: new Date("2026-11-01T00:00:00.000Z"),
	createdByEmail: "admin@qsps.local",
}

function loaded(data: PolicyDocument[]) {
	useDocuments.mockReturnValue({
		data,
		isPending: false,
		isLoading: false,
		isError: false,
		error: null,
		refetch: vi.fn(),
	})
}

describe("PolicyDocumentsSection (ADM-9)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		create.mockResolvedValue(terms)
		update.mockResolvedValue(terms)
		withdraw.mockResolvedValue({ ...terms, state: "withdrawn" })
	})

	it("lists each policy with its state, version and whether it must be accepted", () => {
		loaded([terms])
		render(<PolicyDocumentsSection />)

		const row = screen.getByRole("listitem", { name: "Terms of booking" })
		expect(row).toHaveTextContent("In effect")
		expect(row).toHaveTextContent("Must accept")
		expect(row).toHaveTextContent("Version 2 · All services")
	})

	it("refuses a policy with no title without calling the API", async () => {
		loaded([])
		const user = userEvent.setup()
		render(<PolicyDocumentsSection />)

		await user.click(screen.getByRole("button", { name: "New policy" }))
		const form = screen.getByRole("form", { name: "New policy" })
		await user.click(within(form).getByRole("button", { name: "Publish" }))

		expect(within(form).getByRole("alert")).toHaveTextContent("Enter a title")
		expect(create).not.toHaveBeenCalled()
	})

	it("publishes a new policy for chosen services", async () => {
		loaded([])
		const user = userEvent.setup()
		render(<PolicyDocumentsSection />)

		await user.click(screen.getByRole("button", { name: "New policy" }))
		const form = screen.getByRole("form", { name: "New policy" })
		await user.type(within(form).getByLabelText("Title"), "Vaccination waiver")
		await user.type(within(form).getByLabelText("Text"), "I consent to vaccination.")
		await user.click(within(form).getByLabelText("Chosen services"))
		await user.click(within(form).getByLabelText("Yellow fever vaccination"))
		await user.click(within(form).getByRole("button", { name: "Publish" }))

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Vaccination waiver",
				appliesToAllServices: false,
				serviceIds: [2],
				requiresAcceptance: true,
			})
		)
	})

	it("publishes an edit as the next version of the same policy", async () => {
		loaded([terms])
		const user = userEvent.setup()
		render(<PolicyDocumentsSection />)

		await user.click(screen.getByRole("button", { name: "Edit" }))
		const form = screen.getByRole("form", { name: "Edit Terms of booking" })
		expect(form).toHaveTextContent("version 3")
		await user.click(within(form).getByRole("button", { name: "Publish new version" }))

		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({ documentKey: KEY, title: "Terms of booking" })
		)
	})

	it("withdraws only after a second click", async () => {
		loaded([terms])
		const user = userEvent.setup()
		render(<PolicyDocumentsSection />)

		await user.click(screen.getByRole("button", { name: "Withdraw" }))
		expect(withdraw).not.toHaveBeenCalled()
		await user.click(screen.getByRole("button", { name: "Confirm withdraw" }))
		expect(withdraw).toHaveBeenCalledWith(KEY)
	})

	it("renders nothing for a user without the permission", () => {
		useDocuments.mockReturnValue({
			data: undefined,
			isPending: false,
			isLoading: false,
			isError: true,
			error: new ApiError(403, "Forbidden"),
			refetch: vi.fn(),
		})
		const { container } = render(<PolicyDocumentsSection />)
		expect(container).toBeEmptyDOMElement()
	})
})
