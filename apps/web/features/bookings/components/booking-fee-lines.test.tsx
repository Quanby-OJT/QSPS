import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { feeInPesos } from "@/features/services/lib/fee"

import { BookingFeeLines } from "./booking-fee-lines"

describe("BookingFeeLines (BKG-3)", () => {
	it("shows each Service with its own fee, then the total of the fees", () => {
		render(
			<BookingFeeLines
				lines={[
					{
						key: 1,
						serviceName: "Yellow fever vaccination",
						detail: "Manila",
						feeCentavos: 150000,
					},
					{ key: 3, serviceName: "Basic hygiene seminar", detail: "Cebu", feeCentavos: 50000 },
				]}
				totalCentavos={200000}
			/>
		)

		const rows = within(
			screen.getByRole("list", { name: "Services in this booking" })
		).getAllByRole("listitem")
		expect(rows).toHaveLength(2)
		expect(within(rows[0] as HTMLElement).getByText("Yellow fever vaccination")).toBeInTheDocument()
		expect(within(rows[0] as HTMLElement).getByText(`₱${feeInPesos(150000)}`)).toBeInTheDocument()
		expect(within(rows[1] as HTMLElement).getByText("Basic hygiene seminar")).toBeInTheDocument()
		expect(within(rows[1] as HTMLElement).getByText(`₱${feeInPesos(50000)}`)).toBeInTheDocument()
		expect(screen.getByText("Total")).toBeInTheDocument()
		expect(screen.getByText(`₱${feeInPesos(200000)}`)).toBeInTheDocument()
	})
})
