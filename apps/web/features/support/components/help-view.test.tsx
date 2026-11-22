import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SupportContacts } from "@repo/contracts"

import { HelpView } from "./help-view"

const useContacts = vi.hoisted(() =>
	vi.fn<
		() => {
			data: SupportContacts | undefined
			isPending: boolean
			isLoading: boolean
			isError: boolean
			refetch: () => void
		}
	>()
)

vi.mock("@/features/support/api/support.hooks", () => ({
	useSupportContactsQuery: useContacts,
}))

function loaded(data: SupportContacts) {
	useContacts.mockReturnValue({
		data,
		isPending: false,
		isLoading: false,
		isError: false,
		refetch: vi.fn(),
	})
}

describe("HelpView (ADM-8)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("shows each set channel as a link, and leaves out the blank ones", () => {
		loaded({
			phone: "+63 2 8123 4567",
			email: null,
			ticketUrl: "https://help.example.gov.ph/tickets",
			hours: "Monday to Friday, 8:00 AM to 5:00 PM",
		})
		render(<HelpView />)

		expect(screen.getByRole("link", { name: "+63 2 8123 4567" })).toHaveAttribute(
			"href",
			"tel:+63281234567"
		)
		const ticket = screen.getByRole("link", { name: /help\.example\.gov\.ph/ })
		expect(ticket).toHaveAttribute("target", "_blank")
		expect(ticket).toHaveAttribute("rel", "noopener noreferrer")
		expect(screen.getByText("Monday to Friday, 8:00 AM to 5:00 PM")).toBeInTheDocument()
		expect(screen.queryByText("Email the help desk")).not.toBeInTheDocument()
	})

	it("says so when no channel is published", () => {
		loaded({ phone: null, email: null, ticketUrl: null, hours: null })
		render(<HelpView />)

		expect(screen.getByText("No help desk contacts yet")).toBeInTheDocument()
	})

	it("always links the official BOQ website", () => {
		loaded({ phone: null, email: null, ticketUrl: null, hours: null })
		render(<HelpView />)

		expect(screen.getByRole("link", { name: /Official BOQ website/ })).toHaveAttribute(
			"target",
			"_blank"
		)
	})

	it("offers a retry when the contacts cannot be loaded", () => {
		useContacts.mockReturnValue({
			data: undefined,
			isPending: false,
			isLoading: false,
			isError: true,
			refetch: vi.fn(),
		})
		render(<HelpView />)

		expect(screen.getByText("Could not load the help desk contacts.")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
	})
})
