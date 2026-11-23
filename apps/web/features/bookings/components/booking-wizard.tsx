"use client"

import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"

import {
	checkFormAnswers,
	MAX_BOOKING_ITEMS,
	type Booking,
	type BookingItemFormInput,
	type FormAnswerValue,
	type SlotAvailability,
} from "@repo/contracts"

import { BoqLoader } from "@/core/components/boq-loader"
import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import {
	BookingCheckoutError,
	BookingFormError,
	bookingFormKeys,
	useBookingFormsQuery,
	useCreateBookingMutation,
} from "@/features/bookings/api/bookings.hooks"
import {
	BookingFeeLines,
	feeLinesFromItems,
	slotDetail,
} from "@/features/bookings/components/booking-fee-lines"
import { BookingPolicies } from "@/features/bookings/components/booking-policies"
import {
	canAddToCart,
	cartTotalCentavos,
	checkoutItems,
	clearCartSlot,
	isCartReady,
	removeCartItem,
	upsertCartItem,
	type CartItem,
} from "@/features/bookings/lib/cart"
import { QuestionnaireFields } from "@/features/forms/components/questionnaire-fields"
import { useAvailableLocationsQuery } from "@/features/locations/api/locations.hooks"
import {
	DEFAULT_PAYMENT_CHANNEL,
	useCreatePaymentMutation,
} from "@/features/payments/api/payments.hooks"
import {
	policyDocumentKeys,
	useBookingPoliciesForServicesQuery,
} from "@/features/policies/api/policy-documents.hooks"
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

const STEPS = [
	"Service",
	"Location",
	"Date and time",
	"Your services",
	"Questions",
	"Review",
	"Confirmation",
] as const

const STEP_SERVICE = 0
const STEP_LOCATION = 1
const STEP_SLOT = 2
const STEP_CART = 3
const STEP_QUESTIONS = 4
const STEP_REVIEW = 5
const STEP_DONE = 6

const choiceClassName =
	"border-border hover:bg-muted/60 focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:bg-primary/5 w-full rounded-lg border p-4 text-left outline-none transition-colors focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60"

/** Answers per Service, then per question id. */
type AnswersByService = Record<number, Record<string, FormAnswerValue>>
/** Messages per Service, then per question id. */
type ErrorsByService = Record<number, Record<string, string>>

function newIdempotencyKey(): string {
	return crypto.randomUUID()
}

/**
 * Booking wizard (BKG-1, BKG-3, FRM-2): pick a service, a location and a date
 * and time, and it goes into the cart. Add more Services the same way, each
 * with its own Location and slot. Then answer the questionnaire of every
 * Service that has one, review every fee and the total, and confirm once: one
 * Booking, one Reference Number, one payment. The review step shows the
 * written policies for every Service in the cart (ADM-9); confirming needs
 * every one that requires acceptance to be ticked.
 *
 * Answers are checked here with the same rules the API uses, so each invalid
 * question is flagged before anything is sent. If the API still refuses them
 * (or the questionnaire changed meanwhile), nothing is booked and the client
 * is taken back to the questions. If a slot fills up before confirming, that
 * Service stays in the cart marked for a new time, and the rest are kept.
 *
 * Hydration-safe: the service and location lists show their loading line on
 * the server and on the client's first render, even when the client already
 * holds a restored copy, so the two renders agree.
 */
export function BookingWizard() {
	const services = useAvailableServicesQuery()
	const locations = useAvailableLocationsQuery()
	const createBooking = useCreateBookingMutation()
	const createPayment = useCreatePaymentMutation()
	const queryClient = useQueryClient()
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()

	const [step, setStep] = useState(STEP_SERVICE)
	// BKG-3: the Services chosen so far, in the order they were added.
	const [cart, setCart] = useState<CartItem[]>([])
	// The Service being picked or re-timed; it joins the cart on "Add to booking".
	const [serviceId, setServiceId] = useState<number | null>(null)
	const [locationId, setLocationId] = useState<number | null>(null)
	const [month, setMonth] = useState(() => manilaMonthOf(new Date()))
	const [slot, setSlot] = useState<SlotAvailability | null>(null)
	// Why the last confirm was refused, shown on the cart until the client acts.
	const [checkoutProblem, setCheckoutProblem] = useState<string | null>(null)
	// FRM-2: the client's answers, the flagged questions, and why the API refused them.
	const [answers, setAnswers] = useState<AnswersByService>({})
	const [formErrors, setFormErrors] = useState<ErrorsByService>({})
	const [formProblem, setFormProblem] = useState<string | null>(null)
	const [booking, setBooking] = useState<Booking | null>(null)
	// One key per attempt, so a double click or a retry cannot book twice.
	const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey)
	// Its own key, so a double click on "Pay now" opens one checkout, not two.
	const [paymentKey, setPaymentKey] = useState(newIdempotencyKey)
	// Keeps the BOQ loader up while the browser leaves for the checkout page.
	const [redirecting, setRedirecting] = useState(false)
	// ADM-9: the policy versions the client ticked on the review step.
	const [acceptedPolicyIds, setAcceptedPolicyIds] = useState<ReadonlySet<number>>(() => new Set())

	const servicesLoading =
		!hydrated || isQueryLoading(services) || (!services.isError && !services.data)
	const locationsLoading =
		!hydrated || isQueryLoading(locations) || (!locations.isError && !locations.data)

	const service = services.data?.find(item => item.id === serviceId)
	const location = locations.data?.find(item => item.id === locationId)
	const inCart = (id: number) => cart.some(item => item.serviceId === id)
	const editingCartItem = serviceId !== null && inCart(serviceId)

	const availability = useSlotAvailabilityQuery({
		serviceId: step === STEP_SLOT ? serviceId : null,
		locationId: step === STEP_SLOT ? locationId : null,
		month,
	})
	const slotsByDate = useMemo(() => groupSlotsByDate(availability.data ?? []), [availability.data])

	const cartServiceIds = useMemo(() => cart.map(item => item.serviceId), [cart])

	// FRM-2: loaded from the cart step on, so "Continue" can skip the
	// questions when no Service in the cart has any.
	const bookingForms = useBookingFormsQuery(
		step >= STEP_CART && step < STEP_DONE ? cartServiceIds : []
	)
	const itemsWithForms = cart.flatMap(item => {
		const form = bookingForms.data?.get(item.serviceId)
		return form ? [{ item, form }] : []
	})

	const bookingPolicies = useBookingPoliciesForServicesQuery(
		step === STEP_REVIEW ? cartServiceIds : []
	)
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

	/** Start picking a new Service for the cart. */
	function addAnotherService() {
		setServiceId(null)
		setLocationId(null)
		setSlot(null)
		setStep(STEP_SERVICE)
	}

	/** Pick a new time for a Service already in the cart. */
	function changeTime(item: CartItem) {
		setServiceId(item.serviceId)
		setLocationId(item.locationId)
		setSlot(null)
		if (item.slot) setMonth(manilaMonthOf(item.slot.startsAt))
		setStep(STEP_SLOT)
	}

	/** The picked Service, Location and slot join the cart (or replace its entry). */
	function addToCart() {
		if (!service || !location || !slot) return
		setCart(current =>
			upsertCartItem(current, {
				serviceId: service.id,
				serviceName: service.name,
				feeCentavos: service.feeCentavos,
				locationId: location.id,
				locationName: location.name,
				slot,
			})
		)
		// The cart changed, so any ticks were for a different set of policies.
		setAcceptedPolicyIds(new Set())
		setCheckoutProblem(null)
		setServiceId(null)
		setLocationId(null)
		setSlot(null)
		setStep(STEP_CART)
	}

	function removeFromCart(removedServiceId: number) {
		setCart(current => removeCartItem(current, removedServiceId))
		setAcceptedPolicyIds(new Set())
		setCheckoutProblem(null)
	}

	/** FRM-2: one answer changed; its question is no longer flagged. */
	function setAnswer(answerServiceId: number, fieldId: string, value: FormAnswerValue) {
		setAnswers(current => ({
			...current,
			[answerServiceId]: { ...current[answerServiceId], [fieldId]: value },
		}))
		setFormErrors(current => {
			const forService = current[answerServiceId]
			if (!forService?.[fieldId]) return current
			const rest = { ...forService }
			delete rest[fieldId]
			return { ...current, [answerServiceId]: rest }
		})
	}

	/**
	 * FRM-2: check every questionnaire with the API's rules. Returns the
	 * answers to send, per Service, or null (and flags each invalid question)
	 * when any needs fixing or the questionnaires are not loaded.
	 */
	function checkedForms(): Map<number, BookingItemFormInput> | null {
		const forms = bookingForms.data
		if (!forms) return null
		const checked = new Map<number, BookingItemFormInput>()
		const errors: ErrorsByService = {}
		for (const item of cart) {
			const form = forms.get(item.serviceId)
			if (!form) continue
			const result = checkFormAnswers(form.fields, answers[item.serviceId] ?? {})
			if (result.ok) {
				checked.set(item.serviceId, {
					formTemplateId: form.formTemplateId,
					answers: result.answers,
				})
			} else {
				errors[item.serviceId] = result.fieldErrors
			}
		}
		setFormErrors(errors)
		return Object.keys(errors).length > 0 ? null : checked
	}

	/** From the cart: the questions, or straight to review when there are none. */
	function continueFromCart() {
		setFormProblem(null)
		setStep(bookingForms.isSuccess && itemsWithForms.length === 0 ? STEP_REVIEW : STEP_QUESTIONS)
	}

	function continueFromQuestions() {
		if (!checkedForms()) {
			toast.error("Some answers need fixing")
			return
		}
		setFormProblem(null)
		setStep(STEP_REVIEW)
	}

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
		if (!isCartReady(cart)) return
		const forms = checkedForms()
		if (!forms) {
			setStep(STEP_QUESTIONS)
			return
		}
		try {
			// Only versions still on screen are sent; a stale tick cannot count.
			const shownIds = new Set((bookingPolicies.data ?? []).map(policy => policy.id))
			const created = await createBooking.mutateAsync({
				items: checkoutItems(cart, forms),
				acceptedPolicyDocumentIds: [...acceptedPolicyIds].filter(id => shownIds.has(id)),
				idempotencyKey,
			})
			setBooking(created)
			setStep(STEP_DONE)
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not complete the booking"
			toast.error(message)
			// Nothing was booked. Use a new key for the next attempt, and ask again
			// for the policies, which may have changed while the client reviewed.
			setIdempotencyKey(newIdempotencyKey())
			setAcceptedPolicyIds(new Set())
			if (error instanceof BookingFormError) {
				// FRM-2: back to the questions, with the API's flags or a fresh form.
				if (error.formChanged) {
					void queryClient.invalidateQueries({ queryKey: bookingFormKeys.all })
				}
				if (error.serviceId !== null && Object.keys(error.fieldErrors).length > 0) {
					setFormErrors({ [error.serviceId]: error.fieldErrors })
				}
				setFormProblem(message)
				setStep(STEP_QUESTIONS)
			} else if (error instanceof BookingCheckoutError) {
				// BKG-3: the slot named by the API is taken or closed; that Service
				// stays in the cart and waits for a new time, the others are kept.
				setCart(current => clearCartSlot(current, error.scheduleSlotId))
				setCheckoutProblem(message)
				setStep(STEP_CART)
			}
			// Availability and the policies shown may be out of date; reload both.
			void queryClient.invalidateQueries({ queryKey: ["schedules"] })
			void queryClient.invalidateQueries({ queryKey: policyDocumentKeys.all })
		}
	}

	function startOver() {
		setBooking(null)
		setCart([])
		setSlot(null)
		setServiceId(null)
		setLocationId(null)
		setCheckoutProblem(null)
		setAnswers({})
		setFormErrors({})
		setFormProblem(null)
		setAcceptedPolicyIds(new Set())
		setIdempotencyKey(newIdempotencyKey())
		setStep(STEP_SERVICE)
	}

	const reviewLines = cart.flatMap(item =>
		item.slot
			? [
					{
						key: item.serviceId,
						serviceName: item.serviceName,
						detail: slotDetail(item.locationName, item.slot),
						feeCentavos: item.feeCentavos,
					},
				]
			: []
	)

	return (
		<section className="flex w-full max-w-3xl flex-col gap-6">
			{createBooking.isPending ? (
				<BoqLoader label={cart.length > 1 ? "Reserving your slots" : "Reserving your slot"} />
			) : null}
			{createPayment.isPending || redirecting ? (
				<BoqLoader label="Opening secure checkout" />
			) : null}
			<PageHeader
				title="Book an appointment"
				description="Choose one or more services, each with a BOQ location and a date and time, answer any questions, then confirm them together. You can pay later."
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

			{step === STEP_SERVICE ? (
				<div className="flex flex-col gap-3">
					<h2 className="text-lg font-semibold">
						{cart.length > 0 ? "Choose another service" : "Choose a service"}
					</h2>
					{servicesLoading ? (
						<p className="text-muted-foreground text-sm" role="status">
							Loading services…
						</p>
					) : services.isError ? (
						<LoadError message={services.error.message} onRetry={() => void services.refetch()} />
					) : services.data.length === 0 ? (
						<p className="text-muted-foreground text-sm">No services can be booked yet.</p>
					) : (
						services.data.map(item => {
							const alreadyAdded = inCart(item.id)
							return (
								<button
									key={item.id}
									type="button"
									className={choiceClassName}
									aria-pressed={item.id === serviceId}
									disabled={alreadyAdded}
									onClick={() => {
										setServiceId(item.id)
										setSlot(null)
									}}
								>
									<span className="block font-medium">{item.name}</span>
									<span className="text-muted-foreground block text-sm">
										{alreadyAdded
											? "Already in this booking"
											: `${item.categoryName} · ₱${feeInPesos(item.feeCentavos)}`}
									</span>
								</button>
							)
						})
					)}
					<WizardActions
						onBack={cart.length > 0 ? () => setStep(STEP_CART) : undefined}
						backLabel="Back to your services"
						onNext={() => setStep(STEP_LOCATION)}
						nextDisabled={serviceId === null}
					/>
				</div>
			) : null}

			{step === STEP_LOCATION ? (
				<div className="flex flex-col gap-3">
					<h2 className="text-lg font-semibold">Choose a location</h2>
					{service ? <p className="text-muted-foreground text-sm">For {service.name}</p> : null}
					{locationsLoading ? (
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
						onBack={() => setStep(STEP_SERVICE)}
						onNext={() => setStep(STEP_SLOT)}
						nextDisabled={locationId === null}
					/>
				</div>
			) : null}

			{step === STEP_SLOT ? (
				<div className="flex flex-col gap-3">
					<h2 className="text-lg font-semibold">Choose a date and time</h2>
					{service && location ? (
						<p className="text-muted-foreground text-sm">
							For {service.name} at {location.name}
						</p>
					) : null}
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
						onBack={() => (editingCartItem ? setStep(STEP_CART) : setStep(STEP_LOCATION))}
						backLabel={editingCartItem ? "Back to your services" : "Back"}
						onNext={addToCart}
						nextLabel={editingCartItem ? "Save new time" : "Add to booking"}
						nextDisabled={slot === null}
					/>
				</div>
			) : null}

			{step === STEP_CART ? (
				<div className="flex flex-col gap-3">
					<h2 className="text-lg font-semibold">Your services</h2>
					{checkoutProblem ? (
						<div
							className="border-destructive/30 bg-destructive/5 rounded-lg border p-4"
							role="alert"
						>
							<p className="text-sm font-medium">Nothing was booked yet.</p>
							<p className="text-muted-foreground mt-1 text-sm">{checkoutProblem}</p>
						</div>
					) : null}
					{cart.length === 0 ? (
						<p className="text-muted-foreground text-sm">No services added yet.</p>
					) : (
						<ul className="flex flex-col gap-3" aria-label="Services to book">
							{cart.map(item => (
								<li
									key={item.serviceId}
									className={
										item.slot
											? "border-border rounded-lg border p-4"
											: "border-destructive/40 rounded-lg border p-4"
									}
								>
									<div className="flex flex-wrap items-start justify-between gap-2">
										<div>
											<p className="font-medium">{item.serviceName}</p>
											<p className="text-muted-foreground text-sm">
												{item.slot
													? slotDetail(item.locationName, item.slot)
													: `${item.locationName} · Choose a new time: the one you picked is no longer available`}
											</p>
										</div>
										<p className="font-medium tabular-nums">₱{feeInPesos(item.feeCentavos)}</p>
									</div>
									<div className="mt-3 flex flex-wrap gap-2">
										<Button
											type="button"
											size="sm"
											variant={item.slot ? "outline" : "default"}
											onClick={() => changeTime(item)}
										>
											{item.slot ? "Change time" : "Choose a new time"}
										</Button>
										<Button
											type="button"
											size="sm"
											variant="ghost"
											onClick={() => removeFromCart(item.serviceId)}
										>
											Remove
										</Button>
									</div>
								</li>
							))}
						</ul>
					)}
					{cart.length > 0 ? (
						<p className="text-sm">
							Total <span className="font-semibold">₱{feeInPesos(cartTotalCentavos(cart))}</span>{" "}
							for {cart.length} {cart.length === 1 ? "service" : "services"}, paid once.
						</p>
					) : null}
					{canAddToCart(cart) ? (
						<Button
							type="button"
							variant="outline"
							className="self-start"
							onClick={addAnotherService}
						>
							Add another service
						</Button>
					) : (
						<p className="text-muted-foreground text-sm">
							You can book up to {MAX_BOOKING_ITEMS} services in one checkout.
						</p>
					)}
					<WizardActions
						onNext={continueFromCart}
						nextLabel="Continue"
						nextDisabled={!isCartReady(cart)}
					/>
				</div>
			) : null}

			{step === STEP_QUESTIONS && isCartReady(cart) ? (
				<div className="flex flex-col gap-4">
					<h2 className="text-lg font-semibold">Answer the questions</h2>
					<p className="text-muted-foreground text-sm">
						BOQ staff use your answers to prepare for your visit. Questions marked * are required.
						You can change your answers until you pay.
					</p>
					{formProblem ? (
						<div
							className="border-destructive/30 bg-destructive/5 rounded-lg border p-4"
							role="alert"
						>
							<p className="text-sm font-medium">Nothing was booked yet.</p>
							<p className="text-muted-foreground mt-1 text-sm">{formProblem}</p>
						</div>
					) : null}
					{bookingForms.isPending ? (
						<p className="text-muted-foreground text-sm" role="status">
							Loading questions…
						</p>
					) : bookingForms.isError ? (
						<LoadError
							message="The questions could not be loaded."
							onRetry={bookingForms.refetch}
						/>
					) : itemsWithForms.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							None of your services has questions to answer.
						</p>
					) : (
						itemsWithForms.map(({ item, form }) => (
							<section
								key={item.serviceId}
								className="border-border flex flex-col gap-4 rounded-lg border p-4"
								aria-label={`Questions for ${item.serviceName}`}
							>
								<h3 className="font-medium">{item.serviceName}</h3>
								<QuestionnaireFields
									form={form}
									values={answers[item.serviceId] ?? {}}
									errors={formErrors[item.serviceId] ?? {}}
									onChange={(fieldId, value) => setAnswer(item.serviceId, fieldId, value)}
									idPrefix={`service-${item.serviceId}`}
								/>
							</section>
						))
					)}
					<WizardActions
						onBack={() => setStep(STEP_CART)}
						onNext={continueFromQuestions}
						nextLabel="Review booking"
						nextDisabled={!bookingForms.isSuccess}
					/>
				</div>
			) : null}

			{step === STEP_REVIEW && isCartReady(cart) ? (
				<div className="flex flex-col gap-3">
					<h2 className="text-lg font-semibold">Review your booking</h2>
					<div className="border-border rounded-lg border p-4">
						<BookingFeeLines lines={reviewLines} totalCentavos={cartTotalCentavos(cart)} />
					</div>
					<BookingPolicies
						policies={bookingPolicies.data ?? []}
						loading={bookingPolicies.isPending}
						failed={bookingPolicies.isError}
						onRetry={bookingPolicies.refetch}
						accepted={acceptedPolicyIds}
						onAcceptedChange={setPolicyAccepted}
					/>
					<p className="text-muted-foreground text-sm">
						Confirming reserves every slot above together, under one Reference Number. You do not
						need to pay now, but an unpaid booking is held for a limited time.
					</p>
					{policiesReady && stillToAccept.length > 0 ? (
						<p className="text-sm" role="status">
							Tick {stillToAccept.length === 1 ? "the booking term" : "each booking term"} above to
							confirm.
						</p>
					) : null}
					<WizardActions
						onBack={() => setStep(itemsWithForms.length > 0 ? STEP_QUESTIONS : STEP_CART)}
						onNext={() => void confirm()}
						nextLabel={createBooking.isPending ? "Confirming…" : "Confirm booking"}
						nextDisabled={
							createBooking.isPending ||
							!policiesReady ||
							!bookingForms.isSuccess ||
							stillToAccept.length > 0
						}
					/>
				</div>
			) : null}

			{step === STEP_DONE && booking ? (
				<div className="flex flex-col gap-4" role="status">
					<h2 className="text-lg font-semibold">
						{booking.items.length > 1 ? "Your slots are reserved" : "Your slot is reserved"}
					</h2>
					<div className="border-border flex flex-col items-center gap-4 rounded-lg border p-6 sm:flex-row sm:items-start">
						<div className="rounded-lg bg-white p-3">
							<QRCodeSVG
								value={booking.referenceNumber}
								size={160}
								title={`QR code for reference number ${booking.referenceNumber}`}
							/>
						</div>
						<div className="flex w-full flex-col gap-3">
							<div>
								<p className="text-muted-foreground text-sm">Reference Number</p>
								<p className="font-mono text-2xl font-semibold tracking-wide">
									{booking.referenceNumber}
								</p>
							</div>
							<Badge variant="secondary">Pending payment</Badge>
							<BookingFeeLines
								lines={feeLinesFromItems(booking.items)}
								totalCentavos={booking.totalCentavos}
							/>
							{booking.holdExpiresAt ? (
								<p className="text-sm">
									Pay by{" "}
									<span className="font-medium">
										{manilaTime(booking.holdExpiresAt)} on{" "}
										{dateLabel(manilaDateKey(booking.holdExpiresAt))}
									</span>{" "}
									to keep {booking.items.length > 1 ? "these slots" : "this slot"}.
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
	backLabel = "Back",
	onNext,
	nextLabel = "Continue",
	nextDisabled,
}: {
	onBack?: () => void
	backLabel?: string
	onNext: () => void
	nextLabel?: string
	nextDisabled?: boolean
}) {
	return (
		<div className="flex justify-between gap-2 pt-2">
			{onBack ? (
				<Button type="button" variant="outline" onClick={onBack}>
					{backLabel}
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
