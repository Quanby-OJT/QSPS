import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { Booking } from "@repo/contracts"

import { feeInPesos } from "@/features/services/lib/fee"

import { UnpaidBookingDetails } from "./unpaid-booking-card"

vi.mock("@/features/bookings/components/reschedule-item-dialog", () => ({
	RescheduleItemDialog: ({ open, item }: { open: boolean; item: { serviceName: string } | null }) =>
		open && item ? <div role="dialog">Reschedule dialog for {item.serviceName}</div> : null,
}))

const booking: Booking = {
	id: 31,
	referenceNumber: "QSPS-261122-AB12CD",
	status: "pending_payment",
	kind: "regular",
	totalCentavos: 150000,
	holdExpiresAt: new Date("2026-11-22T08:00:00.000Z"),
	payOnsite: false,
	cancelReason: null,
	cancelledAt: null,
	createdAt: new Date("2026-11-22T07:00:00.000Z"),
	items: [
		{
			id: 44,
			serviceId: 1,
			serviceName: "Yellow fever vaccination",
			locationId: 2,
			locationName: "Manila",
			scheduleSlotId: 7,
			startsAt: new Date("2026-12-02T00:00:00.000Z"),
			endsAt: new Date("2026-12-02T04:00:00.000Z"),
			feeCentavos: 150000,
			rescheduleCount: 0,
			status: "booked",
		},
	],
}

function renderDetails(overrides: Partial<Booking> = {}) {
	const handlers = { onPayNow: vi.fn(), onPayOnsite: vi.fn(), onCancel: vi.fn() }
	render(
		<UnpaidBookingDetails
			booking={{ ...booking, ...overrides }}
			paying={false}
			choosingOnsite={false}
			cancelling={false}
			{...handlers}
		/>
	)
	return handlers
}

describe("UnpaidBookingDetails (BKG-2, BKG-5)", () => {
	it("shows the Reference Number, the service, reschedule counter and the pay-by time", () => {
		renderDetails()
		expect(screen.getByText("QSPS-261122-AB12CD")).toBeInTheDocument()
		expect(screen.getAllByText("Yellow fever vaccination").length).toBeGreaterThan(0)
		expect(screen.getByText(/Rescheduled 0 times/)).toBeInTheDocument()
		expect(screen.getByText(/or the booking is cancelled/)).toBeInTheDocument()
	})

	it("opens the reschedule dialog when Reschedule is clicked on a booked item", async () => {
		const user = userEvent.setup()
		renderDetails()
		await user.click(screen.getByRole("button", { name: "Reschedule" }))
		expect(screen.getByRole("dialog")).toHaveTextContent(
			"Reschedule dialog for Yellow fever vaccination"
		)
	})

	it("pays online or switches to paying at the office", async () => {
		const user = userEvent.setup()
		const handlers = renderDetails()

		await user.click(screen.getByRole("button", { name: "Pay now" }))
		await user.click(screen.getByRole("button", { name: "Pay at the office" }))

		expect(handlers.onPayNow).toHaveBeenCalledTimes(1)
		expect(handlers.onPayOnsite).toHaveBeenCalledTimes(1)
	})

	it("asks before cancelling, and can be backed out of", async () => {
		const user = userEvent.setup()
		const handlers = renderDetails()

		await user.click(screen.getByRole("button", { name: "Cancel booking" }))
		expect(handlers.onCancel).not.toHaveBeenCalled()
		await user.click(screen.getByRole("button", { name: "Keep it" }))
		expect(screen.getByRole("button", { name: "Pay now" })).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Cancel booking" }))
		await user.click(screen.getByRole("button", { name: "Yes, cancel it" }))
		expect(handlers.onCancel).toHaveBeenCalledTimes(1)
	})

	it("explains the arrival cutoff once paying at the office was chosen", () => {
		renderDetails({ payOnsite: true, holdExpiresAt: null })
		expect(screen.getByText(/pay at the BOQ cashier/)).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Pay at the office" })).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Pay now" })).toBeInTheDocument()
	})

	it("lists every Service with its own fee and the total (BKG-3)", () => {
		renderDetails({
			totalCentavos: 200000,
			items: [
				...booking.items,
				{
					id: 45,
					serviceId: 3,
					serviceName: "Basic hygiene seminar",
					locationId: 4,
					locationName: "Cebu",
					scheduleSlotId: 9,
					startsAt: new Date("2026-12-03T01:00:00.000Z"),
					endsAt: new Date("2026-12-03T03:00:00.000Z"),
					feeCentavos: 50000,
					rescheduleCount: 1,
					status: "booked",
				},
			],
		})
		expect(screen.getAllByText("Yellow fever vaccination").length).toBeGreaterThan(0)
		expect(screen.getAllByText("Basic hygiene seminar").length).toBeGreaterThan(0)
		expect(screen.getByText(`₱${feeInPesos(150000)}`)).toBeInTheDocument()
		expect(screen.getByText(`₱${feeInPesos(50000)}`)).toBeInTheDocument()
		expect(screen.getByText(`₱${feeInPesos(200000)}`)).toBeInTheDocument()
	})
})

describe("UnpaidBookingDetails application form (CRT-4)", () => {
	const physicalExam: Booking["items"][number] = {
		id: 218,
		serviceId: 55,
		serviceName: "Physical Examination",
		locationId: 2,
		locationName: "Manila",
		scheduleSlotId: 9,
		startsAt: new Date("2026-12-02T00:00:00.000Z"),
		endsAt: new Date("2026-12-02T04:00:00.000Z"),
		feeCentavos: 50000,
		rescheduleCount: 0,
		status: "booked",
	}

	it("links the client to their own Physical Examination application form", () => {
		renderDetails({ items: [...booking.items, physicalExam] })
		const link = screen.getByRole("link", { name: /application form for Physical Examination/ })
		expect(link).toHaveAttribute(
			"href",
			expect.stringContaining("/certificates/printouts/booking-items/218/application-form")
		)
		expect(link).toHaveAttribute("target", "_blank")
	})

	it("shows no application form link without a Physical Examination", () => {
		renderDetails()
		expect(screen.queryByRole("link", { name: /application form/ })).not.toBeInTheDocument()
	})
})
