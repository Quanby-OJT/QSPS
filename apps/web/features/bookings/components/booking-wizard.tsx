"use client"

import { useMemo, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"

import type { Booking, SlotAvailability } from "@repo/contracts"

import { BoqLoader } from "@/core/components/boq-loader"
import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import { useCreateBookingMutation } from "@/features/bookings/api/bookings.hooks"
import { BookingPolicies } from "@/features/bookings/components/booking-policies"
import { useAvailableLocationsQuery } from "@/features/locations/api/locations.hooks"
import {
	DEFAULT_PAYMENT_CHANNEL,
	useCreatePaymentMutation,
} from "@/features/payments/api/payments.hooks"
import { useBookingPoliciesQuery } from "@/features/policies/api/policy-documents.hooks"
import { missingAcceptances } from "@/features/policies/lib/policy-documents"
import { useSlotAvailabilityQuery } from "@/features/schedules/api/schedules.hooks"
import {
	dateLabel,
	groupSlotsByDate,
	manilaDateKey,
	manilaMonthOf,
	manilaTime,
	monthLabel,
	shiftMonth,
	slotTimeRange,
} from "@/features/schedules/lib/calendar"
import { useAvailableServicesQuery } from "@/features/services/api/services.hooks"
import { feeInPesos } from "@/features/services/lib/fee"

const STEPS = ["Service", "Location", "Date and time", "Review", "Confirmation"] as const

const choiceClassName =
	"border-border hover:bg-muted/60 focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:bg-primary/5 w-full rounded-lg border p-4 text-left outline-none transition-colors focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60"

function newIdempotencyKey(): string {
	return crypto.randomUUID()
}

/**
 * Booking wizard (BKG-1): service, location, date and time, review, then a
 * confirmation with the Reference Number and its QR code. The review step
 * shows the written policies for the Service (ADM-9); confirming needs every
 * one that requires acceptance to be ticked.
 */
export function BookingWizard() {
	const services = useAvailableServicesQuery()
	const locations = useAvailableLocationsQuery()
	const createBooking = useCreateBookingMutation()
	const createPayment = useCreatePaymentMutation()

	const [step, setStep] = useState(0)
	const [serviceId, setServiceId] = useState<number | null>(null)
	const [locationId, setLocationId] = useState<number | null>(null)
	const [month, setMonth] = useState(() => manilaMonthOf(new Date()))
	const [slot, setSlot] = useState<SlotAvailability | null>(null)
	const [booking, setBooking] = useState<Booking | null>(null)
	// One key per attempt, so a double click or a retry cannot book twice.
	const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey)
	// Its own key, so a double click on "Pay now" opens one checkout, not two.
	const [paymentKey, setPaymentKey] = useState(newIdempotencyKey)
	// Keeps the BOQ loader up while the browser leaves for the checkout page.
	const [redirecting, setRedirecting] = useState(false)
	// ADM-9: the policy versions the client ticked on the review step.
	const [acceptedPolicyIds, setAcceptedPolicyIds] = useState<ReadonlySet<number>>(() => new Set())

	const service = services.data?.find(item => item.id === serviceId)
	const location = locations.data?.find(item => item.id === locationId)

	const availability = useSlotAvailabilityQuery({
		serviceId: step >= 2 ? serviceId : null,
		locationId: step >= 2 ? locationId : null,
		month,
	})
	const slotsByDate = useMemo(() => groupSlotsByDate(availability.data ?? []), [availability.data])
	const bookingPolicies = useBookingPoliciesQuery(step === 3 ? serviceId : null)
	const policiesReady = bookingPolicies.isSuccess
	const stillToAccept = missingAcceptances(bookingPolicies.data ?? [], acceptedPolicyIds)

	function setPolicyAccepted(policyId: number, accepted: boolean) {
		setAcceptedPolicyIds(current => {
			const next = new Set(current)
			if (accepted) next.add(policyId)
			else next.delete(policyId)
			return next
		})
	}
	const currentMonth = manilaMonthOf(new Date())

	// PAY-1: send the client to the provider's hosted checkout. The booking is
	// marked paid only when the provider's signed notification arrives, never
	// by this page or the return page.
	async function payNow() {
		if (!booking) return
		try {
			const checkout = await createPayment.mutateAsync({
				bookingId: booking.id,
				channelCode: DEFAULT_PAYMENT_CHANNEL,
				idempotencyKey: paymentKey,
			})
			setRedirecting(true)
			window.location.assign(checkout.checkoutUrl)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not start the payment")
			setPaymentKey(newIdempotencyKey())
		}
	}

	async function confirm() {
		if (!slot) return
		try {
			// Only versions still on screen are sent; a stale tick cannot count.
			const shownIds = new Set((bookingPolicies.data ?? []).map(policy => policy.id))
			const created = await createBooking.mutateAsync({
				scheduleSlotId: slot.id,
				acceptedPolicyDocumentIds: [...acceptedPolicyIds].filter(id => shownIds.has(id)),
				idempotencyKey,
			})
			setBooking(created)
			setStep(4)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not complete the booking")
			// The slot may have filled while the client was reviewing: go back to
			// fresh availability, and use a new key for the next attempt.
			setIdempotencyKey(newIdempotencyKey())
			setSlot(null)
			// A policy may have changed while the client was reviewing; ask again.
			setAcceptedPolicyIds(new Set())
			setStep(2)
			void availability.refetch()
		}
	}

	function startOver() {
		setBooking(null)
		setSlot(null)
		setServiceId(null)
		setLocationId(null)
		setAcceptedPolicyIds(new Set())
		setIdempotencyKey(newIdempotencyKey())
		setStep(0)
	}

	return (
		<section className="flex w-full max-w-3xl flex-col gap-6">
			{createBooking.isPending ? <BoqLoader label="Reserving your slot" /> : null}
			{createPayment.isPending || redirecting ? (
				<BoqLoader label="Opening secure checkout" />
			) : null}
			<PageHeader
				title="Book an appointment"
				description="Choose a service, a BOQ location, and a date and time. You can pay later."
			/>

			<ol className="flex flex-wrap gap-2 text-sm" aria-label="Booking steps">
				{STEPS.map((label, index) => (
					<li
						key={label}
						aria-current={index === step ? "step" : undefined}
						className={
							index === step
								? "bg-primary text-primary-foreground rounded-full px-3 py-1 font-medium"
								: index < step
									? "bg-muted rounded-full px-3 py-1"
									: "text-muted-foreground rounded-full px-3 py-1"
						}
					>
						{index + 1}. {label}
					</li>
				))}
			</ol>

			{step === 0 ? (
				<div className="flex flex-col gap-3">
					<h2 className="text-lg font-semibold">Choose a service</h2>
					{services.isPending ? (
						<p className="text-muted-foreground text-sm" role="status">
							Loading services…
						</p>
					) : services.isError ? (
						<LoadError message={services.error.message} onRetry={() => void services.refetch()} />
					) : services.data.length === 0 ? (
						<p className="text-muted-foreground text-sm">No services can be booked yet.</p>
					) : (
						services.data.map(item => (
							<button
								key={item.id}
								type="button"
								className={choiceClassName}
								aria-pressed={item.id === serviceId}
								onClick={() => {
									setServiceId(item.id)
									setSlot(null)
									setAcceptedPolicyIds(new Set())
								}}
							>
								<span className="block font-medium">{item.name}</span>
								<span className="text-muted-foreground block text-sm">
									{item.categoryName} · ₱{feeInPesos(item.feeCentavos)}
								</span>
							</button>
						))
					)}
					<WizardActions onNext={() => setStep(1)} nextDisabled={serviceId === null} />
				</div>
			) : null}

			{step === 1 ? (
				<div className="flex flex-col gap-3">
					<h2 className="text-lg font-semibold">Choose a location</h2>
					{locations.isPending ? (
						<p className="text-muted-foreground text-sm" role="status">
							Loading locations…
						</p>
					) : locations.isError ? (
						<LoadError message={locations.error.message} onRetry={() => void locations.refetch()} />
					) : locations.data.length === 0 ? (
						<p className="text-muted-foreground text-sm">No locations are open for booking yet.</p>
					) : (
						locations.data.map(item => (
							<button
								key={item.id}
								type="button"
								className={choiceClassName}
								aria-pressed={item.id === locationId}
								onClick={() => {
									setLocationId(item.id)
									setSlot(null)
								}}
							>
								<span className="block font-medium">{item.name}</span>
								<span className="text-muted-foreground block text-sm">{item.address}</span>
							</button>
						))
					)}
					<WizardActions
						onBack={() => setStep(0)}
						onNext={() => setStep(2)}
						nextDisabled={locationId === null}
					/>
				</div>
			) : null}

			{step === 2 ? (
				<div className="flex flex-col gap-3">
					<h2 className="text-lg font-semibold">Choose a date and time</h2>
					<div className="flex items-center gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={month <= currentMonth}
							onClick={() => setMonth(current => shiftMonth(current, -1))}
						>
							Previous
						</Button>
						<p className="min-w-36 text-center text-sm font-medium" aria-live="polite">
							{monthLabel(month)}
						</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setMonth(current => shiftMonth(current, 1))}
						>
							Next
						</Button>
					</div>
					<p className="text-muted-foreground text-xs">Times are Philippine time.</p>

					{availability.isPending ? (
						<p className="text-muted-foreground text-sm" role="status">
							Loading available times…
						</p>
					) : availability.isError ? (
						<LoadError
							message={availability.error.message}
							onRetry={() => void availability.refetch()}
						/>
					) : slotsByDate.size === 0 ? (
						<p className="text-muted-foreground text-sm">
							No schedule has been opened for {monthLabel(month)}. Try another month.
						</p>
					) : (
						[...slotsByDate.entries()].map(([date, daySlots]) => (
							<div key={date} className="border-border rounded-lg border p-3">
								<p className="text-sm font-medium">{dateLabel(date)}</p>
								<div className="mt-2 flex flex-wrap gap-2">
									{daySlots.map(item => (
										<button
											key={item.id}
											type="button"
											disabled={!item.isAvailable}
											aria-pressed={item.id === slot?.id}
											className="border-border hover:bg-muted/60 focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:bg-primary/5 rounded-md border px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
											onClick={() => setSlot(item)}
										>
											<span className="block font-medium">{slotTimeRange(item)}</span>
											<span className="text-muted-foreground block text-xs">
												{item.isAvailable
													? `${item.remainingCapacity} ${item.remainingCapacity === 1 ? "place" : "places"} left`
													: item.remainingCapacity === 0
														? "Full"
														: "Unavailable"}
											</span>
										</button>
									))}
								</div>
							</div>
						))
					)}
					<WizardActions
						onBack={() => setStep(1)}
						onNext={() => setStep(3)}
						nextDisabled={slot === null}
					/>
				</div>
			) : null}

			{step === 3 && slot ? (
				<div className="flex flex-col gap-3">
					<h2 className="text-lg font-semibold">Review your booking</h2>
					<dl className="border-border grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
						<Detail label="Service" value={service?.name ?? "—"} />
						<Detail label="Location" value={location?.name ?? "—"} />
						<Detail label="Date" value={dateLabel(manilaDateKey(slot.startsAt))} />
						<Detail label="Time" value={slotTimeRange(slot)} />
						<Detail label="Fee" value={`₱${feeInPesos(service?.feeCentavos ?? 0)}`} />
					</dl>
					<BookingPolicies
						policies={bookingPolicies.data ?? []}
						loading={bookingPolicies.isPending}
						failed={bookingPolicies.isError}
						onRetry={() => void bookingPolicies.refetch()}
						accepted={acceptedPolicyIds}
						onAcceptedChange={setPolicyAccepted}
					/>
					<p className="text-muted-foreground text-sm">
						Confirming reserves your place. You do not need to pay now, but an unpaid booking is
						held for a limited time.
					</p>
					{policiesReady && stillToAccept.length > 0 ? (
						<p className="text-sm" role="status">
							Tick {stillToAccept.length === 1 ? "the booking term" : "each booking term"} above to
							confirm.
						</p>
					) : null}
					<WizardActions
						onBack={() => setStep(2)}
						onNext={() => void confirm()}
						nextLabel={createBooking.isPending ? "Confirming…" : "Confirm booking"}
						nextDisabled={createBooking.isPending || !policiesReady || stillToAccept.length > 0}
					/>
				</div>
			) : null}

			{step === 4 && booking ? (
				<div className="flex flex-col gap-4" role="status">
					<h2 className="text-lg font-semibold">Your slot is reserved</h2>
					<div className="border-border flex flex-col items-center gap-4 rounded-lg border p-6 sm:flex-row sm:items-start">
						<div className="rounded-lg bg-white p-3">
							<QRCodeSVG
								value={booking.referenceNumber}
								size={160}
								title={`QR code for reference number ${booking.referenceNumber}`}
							/>
						</div>
						<div className="flex flex-col gap-3">
							<div>
								<p className="text-muted-foreground text-sm">Reference Number</p>
								<p className="font-mono text-2xl font-semibold tracking-wide">
									{booking.referenceNumber}
								</p>
							</div>
							<Badge variant="secondary">Pending payment</Badge>
							<dl className="grid gap-2 text-sm">
								{booking.items.map(item => (
									<div key={item.id}>
										<dt className="font-medium">{item.serviceName}</dt>
										<dd className="text-muted-foreground">
											{item.locationName} · {dateLabel(manilaDateKey(item.startsAt))} ·{" "}
											{slotTimeRange(item)}
										</dd>
									</div>
								))}
								<Detail label="Total" value={`₱${feeInPesos(booking.totalCentavos)}`} />
							</dl>
							{booking.holdExpiresAt ? (
								<p className="text-sm">
									Pay by{" "}
									<span className="font-medium">
										{manilaTime(booking.holdExpiresAt)} on{" "}
										{dateLabel(manilaDateKey(booking.holdExpiresAt))}
									</span>{" "}
									to keep this slot.
								</p>
							) : null}
						</div>
					</div>
					<p className="text-muted-foreground text-sm">
						Keep your Reference Number. You will need it, or the QR code, when you pay and when you
						arrive.
					</p>
					<div className="flex flex-wrap gap-2">
						<Button type="button" onClick={() => void payNow()} disabled={createPayment.isPending}>
							{createPayment.isPending ? "Opening checkout…" : "Pay now"}
						</Button>
						<Button type="button" variant="outline" onClick={startOver}>
							Done
						</Button>
					</div>
				</div>
			) : null}
		</section>
	)
}

function Detail({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="font-medium">{value}</dd>
		</div>
	)
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
			<p className="text-sm font-medium">Something went wrong while loading.</p>
			<p className="text-muted-foreground mt-1 text-sm">{message}</p>
			<Button className="mt-3" variant="outline" onClick={onRetry}>
				Retry
			</Button>
		</div>
	)
}

function WizardActions({
	onBack,
	onNext,
	nextLabel = "Continue",
	nextDisabled,
}: {
	onBack?: () => void
	onNext: () => void
	nextLabel?: string
	nextDisabled?: boolean
}) {
	return (
		<div className="flex justify-between gap-2 pt-2">
			{onBack ? (
				<Button type="button" variant="outline" onClick={onBack}>
					Back
				</Button>
			) : (
				<span />
			)}
			<Button type="button" onClick={onNext} disabled={nextDisabled}>
				{nextLabel}
			</Button>
		</div>
	)
}
