import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { PrintoutsPanelView, type PrintoutsPanelViewProps } from "./printouts-panel"

function props(overrides: Partial<PrintoutsPanelViewProps> = {}): PrintoutsPanelViewProps {
	return {
		showApplicationForm: true,
		showRequestForPayment: true,
		printingApplication: false,
		printingRequest: false,
		onPrintApplication: vi.fn(),
		onPrintRequest: vi.fn(),
		...overrides,
	}
}

describe("PrintoutsPanelView", () => {
	it("shows both buttons for a Physical Examination booking awaiting payment", () => {
		render(<PrintoutsPanelView {...props()} />)

		expect(screen.getByRole("button", { name: "Print application form" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Print Request for Payment" })).toBeInTheDocument()
	})

	it("shows only the application form once the booking is paid", () => {
		render(<PrintoutsPanelView {...props({ showRequestForPayment: false })} />)

		expect(screen.getByRole("button", { name: "Print application form" })).toBeInTheDocument()
		expect(
			screen.queryByRole("button", { name: "Print Request for Payment" })
		).not.toBeInTheDocument()
	})

	it("shows nothing for a user who may not print or a Service with no printouts", () => {
		const { container } = render(
			<PrintoutsPanelView
				{...props({ showApplicationForm: false, showRequestForPayment: false })}
			/>
		)

		expect(container).toBeEmptyDOMElement()
	})

	it("calls the matching handler for each button", async () => {
		const user = userEvent.setup()
		const onPrintApplication = vi.fn()
		const onPrintRequest = vi.fn()
		render(<PrintoutsPanelView {...props({ onPrintApplication, onPrintRequest })} />)

		await user.click(screen.getByRole("button", { name: "Print application form" }))
		expect(onPrintApplication).toHaveBeenCalledTimes(1)
		expect(onPrintRequest).not.toHaveBeenCalled()

		await user.click(screen.getByRole("button", { name: "Print Request for Payment" }))
		expect(onPrintRequest).toHaveBeenCalledTimes(1)
	})

	it("disables a button while its printout is opening, so a double click prints once", () => {
		render(<PrintoutsPanelView {...props({ printingApplication: true })} />)

		expect(screen.getByRole("button", { name: "Opening the form" })).toBeDisabled()
		expect(screen.getByRole("button", { name: "Print Request for Payment" })).toBeEnabled()
	})
})
