import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Location } from "@repo/contracts"

import { ClientLocationPicker } from "./client-location-picker"

const useLocations = vi.hoisted(() =>
	vi.fn<
		() => {
			data: Location[] | undefined
			isPending: boolean
			isError: boolean
			refetch: () => void
		}
	>()
)

vi.mock("@/features/locations/api/locations.hooks", () => ({
	useAvailableLocationsQuery: useLocations,
}))

const location: Location = {
	code: "MNL",
	name: "Manila",
	address: "Port Area, Manila",
	region: "NCR",
	isActive: true,
	createdAt: new Date("2026-01-01"),
	updatedAt: new Date("2026-01-01"),
}

describe("ClientLocationPicker", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("lets a client choose an active location and shows its address", async () => {
		useLocations.mockReturnValue({
			data: [location],
			isPending: false,
			isError: false,
			refetch: vi.fn(),
		})

		const user = userEvent.setup()
		render(<ClientLocationPicker />)

		await user.click(screen.getByRole("combobox", { name: "Choose a BOQ location" }))
		await user.click(await screen.findByRole("option", { name: "Manila — NCR" }))

		expect(screen.getByRole("status")).toHaveTextContent("Port Area, Manila")
	})

	it("shows a clear empty state if there are no active locations", () => {
		useLocations.mockReturnValue({
			data: [],
			isPending: false,
			isError: false,
			refetch: vi.fn(),
		})

		render(<ClientLocationPicker />)

		expect(screen.getByText("No active BOQ locations are available right now.")).toBeInTheDocument()
		expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
	})

	it("allows retry when the location request fails", () => {
		const refetch = vi.fn()
		useLocations.mockReturnValue({
			data: undefined,
			isPending: false,
			isError: true,
			refetch,
		})

		render(<ClientLocationPicker />)

		fireEvent.click(screen.getByRole("button", { name: "Retry" }))
		expect(refetch).toHaveBeenCalledOnce()
	})
})
