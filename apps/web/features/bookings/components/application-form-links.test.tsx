import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ApplicationFormLinksView } from "./application-form-links"

describe("ApplicationFormLinksView", () => {
	it("shows nothing when the booking has no application form", () => {
		const { container } = render(<ApplicationFormLinksView forms={[]} />)

		expect(container).toBeEmptyDOMElement()
	})

	it("links to the client's own form for each item, in a new tab", () => {
		render(
			<ApplicationFormLinksView
				forms={[
					{ bookingItemId: 44, serviceName: "Physical Examination" },
					{ bookingItemId: 45, serviceName: "Physical Examination (repeat)" },
				]}
			/>
		)

		const first = screen.getByRole("link", {
			name: "Download the application form for Physical Examination",
		})
		expect(first.getAttribute("href")).toMatch(
			/\/certificates\/printouts\/booking-items\/44\/application-form$/
		)
		expect(first).toHaveAttribute("target", "_blank")
		expect(first).toHaveAttribute("rel", "noopener noreferrer")

		const second = screen.getByRole("link", {
			name: "Download the application form for Physical Examination (repeat)",
		})
		expect(second.getAttribute("href")).toMatch(
			/\/certificates\/printouts\/booking-items\/45\/application-form$/
		)
	})
})
