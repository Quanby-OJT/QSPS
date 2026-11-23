import type { Booking } from "@repo/contracts"

import { dateLabel, manilaDateKey, slotTimeRange } from "@/features/schedules/lib/calendar"
import { feeInPesos } from "@/features/services/lib/fee"

/** One Service in a booking, with its own fee (BKG-3). */
export interface FeeLine {
	key: string | number
	serviceName: string
	/** Where and when, e.g. "Manila · Wed 2 December · 8:00 AM–12:00 PM". */
	detail: string
	feeCentavos: number
}

/** "Manila · <date> · <time>" for a booked or chosen slot. */
export function slotDetail(locationName: string, slot: { startsAt: Date; endsAt: Date }): string {
	return `${locationName} · ${dateLabel(manilaDateKey(slot.startsAt))} · ${slotTimeRange(slot)}`
}

/** The fee lines of a saved Booking, one per Booking Item. */
export function feeLinesFromItems(items: Booking["items"]): FeeLine[] {
	return items.map(item => ({
		key: item.id,
		serviceName: item.serviceName,
		detail: slotDetail(item.locationName, item),
		feeCentavos: item.feeCentavos,
	}))
}

/**
 * BKG-3: each Service on its own line with its own fee, then the total. Used
 * on the review step, the confirmation and the unpaid booking card; the
 * e-Receipt itemizes the same Booking Items.
 */
export function BookingFeeLines({
	lines,
	totalCentavos,
}: {
	lines: readonly FeeLine[]
	totalCentavos: number
}) {
	return (
		<div className="text-sm">
			<ul className="divide-border divide-y" aria-label="Services in this booking">
				{lines.map(line => (
					<li key={line.key} className="flex items-start justify-between gap-4 py-2">
						<div>
							<p className="font-medium">{line.serviceName}</p>
							<p className="text-muted-foreground">{line.detail}</p>
						</div>
						<p className="shrink-0 font-medium tabular-nums">₱{feeInPesos(line.feeCentavos)}</p>
					</li>
				))}
			</ul>
			<div className="border-border flex items-center justify-between gap-4 border-t pt-2">
				<p className="font-semibold">Total</p>
				<p className="font-semibold tabular-nums">₱{feeInPesos(totalCentavos)}</p>
			</div>
		</div>
	)
}
