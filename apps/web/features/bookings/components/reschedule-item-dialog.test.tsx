import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Booking, SlotAvailability } from "@repo/contracts"

import { RescheduleItemDialog } from "./reschedule-item-dialog"

const mutateAsync = vi.fn()
const useSlotAvailabilityQueryMock = vi.fn()

vi.mock("@/features/bookings/api/bookings.hooks", () => ({
	useRescheduleBookingItemMutation: () => ({
		mutateAsync,
		isPending: false,
	}),
}))

vi.mock("@/features/schedules/api/schedules.hooks", () => ({
	useSlotAvailabilityQuery: (args: unknown) => useSlotAvailabilityQueryMock(args),
}))

const item: Booking["items"][number] = {
	id: 44,
	serviceId: 1,
	serviceName: "Yellow fever vaccination",
	locationId: 2,
	locationName: "Manila",
	scheduleSlotId: 7,
	startsAt: new Date("2026-12-02T00:00:00.000Z"),
	endsAt: new Date("2026-12-02T04:00:00.000Z"),
	feeCentavos: 150000,
	rescheduleCount: 1,
	status: "booked",
}

const slots: SlotAvailability[] = [
	{
		id: 7,
		serviceId: 1,
		locationId: 2,
		startsAt: new Date("2026-12-02T00:00:00.000Z"),
		endsAt: new Date("2026-12-02T04:00:00.000Z"),
		capacity: 10,
		bookedCount: 5,
		remainingCapacity: 5,
		isAvailable: true,
	},
	{
		id: 12,
		serviceId: 1,
		locationId: 2,
		startsAt: new Date("2026-12-04T00:00:00.000Z"),
		endsAt: new Date("2026-12-04T04:00:00.000Z"),
		capacity: 10,
		bookedCount: 2,
		remainingCapacity: 8,
		isAvailable: true,
	},
]

describe("RescheduleItemDialog (BKG-5)", () => {
	beforeEach(() => {
		mutateAsync.mockReset()
		useSlotAvailabilityQueryMock.mockReturnValue({
			data: slots,
			isPending: false,
			isError: false,
			refetch: vi.fn(),
		})
	})

	it("shows the reschedule counter, disables the current slot, and submits the chosen slot", async () => {
		const user = userEvent.setup()
		const onOpenChange = vi.fn()
		mutateAsync.mockResolvedValue({
			id: 31,
			items: [{ ...item, scheduleSlotId: 12, rescheduleCount: 2 }],
		})

		render(
			<RescheduleItemDialog
				bookingId={31}
				item={item}
				open
				onOpenChange={onOpenChange}
			/>
		)

		expect(screen.getByText(/Reschedules used on this item:/)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Current slot/ })).toBeDisabled()

		const newSlotButton = screen.getByRole("button", { name: /8 places left/ })
		await user.click(newSlotButton)
		await user.click(screen.getByRole("button", { name: "Confirm reschedule" }))

		expect(mutateAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				bookingId: 31,
				bookingItemId: 44,
				scheduleSlotId: 12,
			})
		)
		expect(onOpenChange).toHaveBeenCalledWith(false)
	})
})