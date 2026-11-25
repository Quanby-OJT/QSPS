import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { BookingDetail, BookingSummary } from "@repo/contracts"

import { feeInPesos } from "@/features/services/lib/fee"

import { BookingDetailContent } from "./booking-detail"
import { MyTransactionsList } from "./my-transactions"

const paidBooking: BookingSummary = {
	id: 42,
	referenceNumber: "QSPS-261123-NEW123",
	status: "paid",
	clientStatus: "Paid",
	totalCentavos: 200000,
	payOnsite: false,
	holdExpiresAt: null,
	createdAt: new Date("2026-11-23T09:00:00.000Z"),
	items: [
		{
			id: 101,
			serviceId: 1,
			serviceName: "Yellow fever vaccination",
			locationId: 2,
			locationName: "Manila",
			scheduleSlotId: 7,
			startsAt: new Date("2026-12-02T00:00:00.000Z"),
			endsAt: new Date("2026-12-02T04:00:00.000Z"),
			feeCentavos: 150000,
			rescheduleCount: 0,
			status: "checked_in",
		},
		{
			id: 102,
			serviceId: 3,
			serviceName: "Basic hygiene seminar",
			locationId: 2,
			locationName: "Manila",
			scheduleSlotId: 8,
			startsAt: new Date("2026-12-02T05:00:00.000Z"),
			endsAt: new Date("2026-12-02T07:00:00.000Z"),
			feeCentavos: 50000,
			rescheduleCount: 0,
			status: "booked",
		},
	],
}

const pendingBooking: BookingSummary = {
	id: 31,
	referenceNumber: "QSPS-261120-OLD456",
	status: "pending_payment",
	clientStatus: "Pending",
	totalCentavos: 150000,
	payOnsite: false,
	holdExpiresAt: new Date("2026-11-20T10:00:00.000Z"),
	createdAt: new Date("2026-11-20T09:00:00.000Z"),
	items: [
		{
			id: 90,
			serviceId: 1,
			serviceName: "Yellow fever vaccination",
			locationId: 2,
			locationName: "Manila",
			scheduleSlotId: 5,
			startsAt: new Date("2026-11-25T00:00:00.000Z"),
			endsAt: new Date("2026-11-25T04:00:00.000Z"),
			feeCentavos: 150000,
			rescheduleCount: 0,
			status: "booked",
		},
	],
}

describe("MyTransactionsList (BKG-4 AC 1 & AC 3)", () => {
	it("shows every booking newest first with Reference Number, Services, schedule, total, and status", () => {
		render(<MyTransactionsList bookings={[paidBooking, pendingBooking]} />)

		const cards = screen.getAllByTestId(/^booking-card-/)
		expect(cards.map(card => card.getAttribute("data-testid"))).toEqual([
			"booking-card-42",
			"booking-card-31",
		])

		const firstCard = cards[0] as HTMLElement
		expect(within(firstCard).getByText("QSPS-261123-NEW123")).toBeInTheDocument()
		expect(within(firstCard).getByText("Paid")).toBeInTheDocument()
		expect(within(firstCard).getByText("Yellow fever vaccination")).toBeInTheDocument()
		expect(within(firstCard).getByText("Basic hygiene seminar")).toBeInTheDocument()
		expect(within(firstCard).getAllByText(`₱${feeInPesos(200000)}`).length).toBeGreaterThanOrEqual(
			1
		)
		expect(within(firstCard).getByRole("link", { name: /View details/i })).toHaveAttribute(
			"href",
			"/transactions/42"
		)

		const secondCard = cards[1] as HTMLElement
		expect(within(secondCard).getByText("QSPS-261120-OLD456")).toBeInTheDocument()
		expect(within(secondCard).getByText("Pending")).toBeInTheDocument()
	})

	it("filters by status tabs and shows an empty state when no bookings exist", async () => {
		const user = userEvent.setup()
		const { unmount } = render(<MyTransactionsList bookings={[]} />)
		expect(screen.getByText("No transactions yet")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: /Book a service/i })).toHaveAttribute("href", "/book")
		unmount()

		render(<MyTransactionsList bookings={[paidBooking, pendingBooking]} />)

		await user.click(screen.getByRole("tab", { name: "Pending (1)" }))
		expect(screen.getByText("QSPS-261120-OLD456")).toBeInTheDocument()
		expect(screen.queryByText("QSPS-261123-NEW123")).not.toBeInTheDocument()

		await user.click(screen.getByRole("tab", { name: "Cancelled (0)" }))
		expect(screen.getByText("No cancelled transactions found.")).toBeInTheDocument()
	})
})

describe("BookingDetailContent (BKG-4 AC 2 & AC 3)", () => {
	const completedDetail: BookingDetail = {
		id: 42,
		referenceNumber: "QSPS-261123-NEW123",
		status: "completed",
		clientStatus: "Paid",
		kind: "regular",
		totalCentavos: 150000,
		holdExpiresAt: null,
		payOnsite: false,
		cancelReason: null,
		cancelledAt: null,
		createdAt: new Date("2026-11-23T09:00:00.000Z"),
		items: [
			{
				id: 101,
				serviceId: 1,
				serviceName: "Yellow fever vaccination",
				locationId: 2,
				locationName: "Manila",
				scheduleSlotId: 7,
				startsAt: new Date("2026-12-02T00:00:00.000Z"),
				endsAt: new Date("2026-12-02T04:00:00.000Z"),
				feeCentavos: 150000,
				rescheduleCount: 0,
				status: "issued",
			},
		],
		payment: {
			id: 12,
			amountCentavos: 151500,
			convenienceFeeCentavos: 1500,
			providerCode: "fake",
			channelCode: "gcash",
			channelName: "GCash",
			status: "succeeded",
			paidAt: new Date("2026-11-23T09:05:00.000Z"),
			createdAt: new Date("2026-11-23T09:04:00.000Z"),
		},
		receipt: {
			id: 5,
			paymentId: 12,
			receiptNumber: "QSPS-R-261123-000001",
			verificationToken: "AbCdEfGhIjKlMnOpQrSt_-",
			issuedAt: new Date("2026-11-23T09:05:00.000Z"),
		},
		documents: [
			{
				id: 99,
				bookingItemId: 101,
				serviceName: "Yellow fever vaccination",
				documentType: "icv-record",
				documentNumber: "ICV-MNL-2026-000001",
				status: "valid",
				issuedAt: new Date("2026-12-02T01:30:00.000Z"),
				validUntil: null,
			},
		],
	}

	it("displays each booked Service's processing status, payment details, e-Receipt, and issued Documents", () => {
		render(<BookingDetailContent booking={completedDetail} />)

		expect(screen.getByText("QSPS-261123-NEW123")).toBeInTheDocument()
		expect(screen.getByText("Paid")).toBeInTheDocument()
		expect(screen.getByText("Document issued")).toBeInTheDocument()
		expect(screen.getByText("Succeeded")).toBeInTheDocument()
		expect(screen.getByText("GCash")).toBeInTheDocument()
		expect(screen.getByTitle("QR code for reference number QSPS-261123-NEW123")).toBeInTheDocument()
		expect(screen.getByText(`₱${feeInPesos(151500)}`)).toBeInTheDocument()
		expect(screen.getByText("QSPS-R-261123-000001")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: /View e-Receipt/i })).toHaveAttribute(
			"href",
			"/receipts/verify/AbCdEfGhIjKlMnOpQrSt_-"
		)
		expect(screen.getByText("ICV-MNL-2026-000001")).toBeInTheDocument()
		expect(screen.getByText("Valid")).toBeInTheDocument()
	})

	it("supports unpaid actions (Pay now, Pay at the office, Cancel booking) and shows cancellation status after", async () => {
		const user = userEvent.setup()
		const onPayNow = vi.fn()
		const onPayOnsite = vi.fn()
		const onCancel = vi.fn()

		const unpaidDetail: BookingDetail = {
			...completedDetail,
			status: "pending_payment",
			clientStatus: "Pending",
			holdExpiresAt: new Date("2026-11-23T10:00:00.000Z"),
			items: [{ ...completedDetail.items[0]!, status: "booked" }],
			payment: null,
			receipt: null,
			documents: [],
		}

		const { rerender } = render(
			<BookingDetailContent
				booking={unpaidDetail}
				onPayNow={onPayNow}
				onPayOnsite={onPayOnsite}
				onCancel={onCancel}
			/>
		)

		await user.click(screen.getByRole("button", { name: "Pay now" }))
		expect(onPayNow).toHaveBeenCalledTimes(1)

		await user.click(screen.getByRole("button", { name: "Pay at the office" }))
		expect(onPayOnsite).toHaveBeenCalledTimes(1)

		await user.click(screen.getByRole("button", { name: "Cancel booking" }))
		await user.click(screen.getByRole("button", { name: "Yes, cancel it" }))
		expect(onCancel).toHaveBeenCalledTimes(1)

		rerender(
			<BookingDetailContent
				booking={{
					...unpaidDetail,
					status: "cancelled",
					clientStatus: "Cancelled",
					cancelReason: "client_cancelled",
					cancelledAt: new Date("2026-11-23T09:10:00.000Z"),
				}}
			/>
		)
		// The booking badge, and each item shown as Cancelled rather than Booked.
		expect(screen.getAllByText("Cancelled").length).toBeGreaterThanOrEqual(2)
		expect(screen.queryByText("Booked")).not.toBeInTheDocument()
		expect(screen.getByText(/Cancelled by you/)).toBeInTheDocument()
	})
})
