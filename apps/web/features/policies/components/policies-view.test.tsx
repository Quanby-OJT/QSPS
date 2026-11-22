import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Policy } from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"

import { PoliciesView } from "./policies-view"

const usePolicies = vi.hoisted(() =>
	vi.fn<
		() => {
			data: Policy[] | undefined
			isPending: boolean
			isError: boolean
			error: Error | null
			refetch: () => void
		}
	>()
)
const mutateAsync = vi.hoisted(() => vi.fn())

vi.mock("@/features/policies/api/policies.hooks", () => ({
	usePoliciesQuery: usePolicies,
	useUpdatePolicyMutation: () => ({ mutateAsync, isPending: false }),
}))

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}))

const hold: Policy = {
	key: "booking.hold_minutes",
	area: "booking",
	label: "Unpaid booking hold",
	description: "How long an unpaid booking keeps its slot.",
	type: "integer",
	min: 5,
	max: 1440,
	unit: "minutes",
	format: null,
	maxLength: null,
	defaultValue: 60,
	value: 60,
	isDefault: true,
	updatedAt: null,
	updatedByEmail: null,
}

const expedite: Policy = {
	...hold,
	key: "booking.expedite_enabled",
	label: "Expedite requests",
	description: "Whether clients may request a full date.",
	type: "boolean",
	min: null,
	max: null,
	unit: null,
	defaultValue: true,
	value: true,
}

const lockout: Policy = {
	...hold,
	key: "auth.lockout_minutes",
	area: "auth",
	label: "Lock length",
	description: "How long a locked account stays locked.",
	min: 1,
	defaultValue: 2,
	value: 30,
	isDefault: false,
	updatedAt: new Date("2026-11-21T15:07:00.000Z"),
	updatedByEmail: "admin@qsps.local",
}

const supportEmail: Policy = {
	...hold,
	key: "support.email",
	area: "support",
	label: "Help desk email",
	description: "The address clients write to for help.",
	type: "text",
	min: null,
	max: null,
	unit: null,
	format: "email",
	maxLength: 254,
	defaultValue: "",
	value: "help@example.gov.ph",
	isDefault: false,
}

function loaded(data: Policy[]) {
	usePolicies.mockReturnValue({
		data,
		isPending: false,
		isError: false,
		error: null,
		refetch: vi.fn(),
	})
}

describe("PoliciesView (ADM-6, ADM-8)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mutateAsync.mockResolvedValue(hold)
	})

	it("groups every policy under its area", () => {
		loaded([hold, expedite, lockout])
		render(<PoliciesView />)

		expect(screen.getByRole("heading", { name: "Booking" })).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Sign-in security" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: "Payments and refunds" })).not.toBeInTheDocument()
		expect(screen.getByRole("form", { name: "Lock length" })).toHaveTextContent(
			"Changed by admin@qsps.local"
		)
	})

	it("saves a valid number for one policy", async () => {
		loaded([hold, lockout])
		const user = userEvent.setup()
		render(<PoliciesView />)

		const form = screen.getByRole("form", { name: "Unpaid booking hold" })
		const field = within(form).getByLabelText("Unpaid booking hold")
		await user.clear(field)
		await user.type(field, "90")
		await user.click(within(form).getByRole("button", { name: "Save" }))

		expect(mutateAsync).toHaveBeenCalledWith({ key: "booking.hold_minutes", value: 90 })
	})

	it("refuses a value outside the range without calling the API", async () => {
		loaded([hold])
		const user = userEvent.setup()
		render(<PoliciesView />)

		const form = screen.getByRole("form", { name: "Unpaid booking hold" })
		const field = within(form).getByLabelText("Unpaid booking hold")
		await user.clear(field)
		await user.type(field, "4")
		await user.click(within(form).getByRole("button", { name: "Save" }))

		expect(within(form).getByRole("alert")).toHaveTextContent(
			"Unpaid booking hold must be a whole number from 5 to 1440"
		)
		expect(mutateAsync).not.toHaveBeenCalled()
	})

	it("keeps Save off until something changes, and saves a switched-off checkbox", async () => {
		loaded([expedite])
		const user = userEvent.setup()
		render(<PoliciesView />)

		const form = screen.getByRole("form", { name: "Expedite requests" })
		const save = within(form).getByRole("button", { name: "Save" })
		expect(save).toBeDisabled()

		await user.click(within(form).getByLabelText("Expedite requests"))
		await user.click(save)

		expect(mutateAsync).toHaveBeenCalledWith({ key: "booking.expedite_enabled", value: false })
	})

	it("shows the API's message when a save is refused", async () => {
		loaded([hold])
		mutateAsync.mockRejectedValue(new ApiError(400, "Unpaid booking hold must be a whole number"))
		const user = userEvent.setup()
		render(<PoliciesView />)

		const form = screen.getByRole("form", { name: "Unpaid booking hold" })
		const field = within(form).getByLabelText("Unpaid booking hold")
		await user.clear(field)
		await user.type(field, "90")
		await user.click(within(form).getByRole("button", { name: "Save" }))

		expect(await within(form).findByRole("alert")).toHaveTextContent(
			"Unpaid booking hold must be a whole number"
		)
	})

	it("shows help desk channels under their own area, as text fields", () => {
		loaded([hold, supportEmail])
		render(<PoliciesView />)

		expect(screen.getByRole("heading", { name: "Help desk" })).toBeInTheDocument()
		const form = screen.getByRole("form", { name: "Help desk email" })
		const field = within(form).getByLabelText("Help desk email")
		expect(field).toHaveAttribute("type", "email")
		expect(field).toHaveValue("help@example.gov.ph")
		expect(form).toHaveTextContent("Default: Not set")
	})

	it("saves a cleared channel as blank, which hides it", async () => {
		loaded([supportEmail])
		const user = userEvent.setup()
		render(<PoliciesView />)

		const form = screen.getByRole("form", { name: "Help desk email" })
		await user.clear(within(form).getByLabelText("Help desk email"))
		await user.click(within(form).getByRole("button", { name: "Save" }))

		expect(mutateAsync).toHaveBeenCalledWith({ key: "support.email", value: "" })
	})

	it("refuses a bad email without calling the API", async () => {
		loaded([supportEmail])
		const user = userEvent.setup()
		render(<PoliciesView />)

		const form = screen.getByRole("form", { name: "Help desk email" })
		const field = within(form).getByLabelText("Help desk email")
		await user.clear(field)
		await user.type(field, "not-an-email")
		await user.click(within(form).getByRole("button", { name: "Save" }))

		expect(within(form).getByRole("alert")).toHaveTextContent(
			"Help desk email must be an email address, or blank to hide it"
		)
		expect(mutateAsync).not.toHaveBeenCalled()
	})

	it("says so plainly when the user lacks the permission", () => {
		usePolicies.mockReturnValue({
			data: undefined,
			isPending: false,
			isError: true,
			error: new ApiError(403, "Forbidden"),
			refetch: vi.fn(),
		})
		render(<PoliciesView />)

		expect(screen.getByText("You do not have access to policies")).toBeInTheDocument()
	})
})
