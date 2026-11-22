import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { PolicyDocumentSummary } from "@repo/contracts"

import { BookingPolicies } from "./booking-policies"

const terms: PolicyDocumentSummary = {
	id: 4,
	documentKey: "3f1c2b7e-8a4d-4e5f-9b6a-0c1d2e3f4a5b",
	version: 2,
	title: "Terms of booking",
	body: "Arrive 15 minutes early.\n\nBring a valid ID.",
	requiresAcceptance: true,
	effectiveFrom: "2026-11-01",
	appliesToAllServices: true,
	serviceNames: [],
}

const reading: PolicyDocumentSummary = {
	...terms,
	id: 5,
	title: "Privacy at the clinic",
	requiresAcceptance: false,
}

function renderPolicies(accepted = new Set<number>(), onAcceptedChange = vi.fn()) {
	render(
		<BookingPolicies
			policies={[terms, reading]}
			loading={false}
			failed={false}
			onRetry={vi.fn()}
			accepted={accepted}
			onAcceptedChange={onAcceptedChange}
		/>
	)
	return onAcceptedChange
}

describe("BookingPolicies (ADM-9)", () => {
	it("shows each policy's text as paragraphs", () => {
		renderPolicies()
		expect(screen.getAllByText("Arrive 15 minutes early.")).toHaveLength(2)
		expect(screen.getAllByText("Bring a valid ID.")).toHaveLength(2)
	})

	it("asks for acceptance only where it is required", () => {
		renderPolicies()
		expect(screen.getAllByRole("checkbox")).toHaveLength(1)
		expect(
			screen.getByRole("checkbox", { name: "I have read and accept “Terms of booking”." })
		).not.toBeChecked()
		expect(screen.getByText("For your information.")).toBeInTheDocument()
	})

	it("reports a tick with the version's id", async () => {
		const user = userEvent.setup()
		const onAcceptedChange = renderPolicies()
		await user.click(screen.getByRole("checkbox"))
		expect(onAcceptedChange).toHaveBeenCalledWith(4, true)
	})

	it("shows nothing when no policy applies", () => {
		const { container } = render(
			<BookingPolicies
				policies={[]}
				loading={false}
				failed={false}
				onRetry={vi.fn()}
				accepted={new Set()}
				onAcceptedChange={vi.fn()}
			/>
		)
		expect(container).toBeEmptyDOMElement()
	})

	it("offers a retry when the terms cannot be loaded", () => {
		render(
			<BookingPolicies
				policies={[]}
				loading={false}
				failed
				onRetry={vi.fn()}
				accepted={new Set()}
				onAcceptedChange={vi.fn()}
			/>
		)
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
	})
})
