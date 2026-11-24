"use client"

import { useState, type FormEvent } from "react"
import { Search01Icon, UserGroupIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQueryClient } from "@tanstack/react-query"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"

import {
	checkFormAnswers,
	type Booking,
	type BookingItemFormInput,
	type FormAnswerValue,
	type WalkInClient,
	type WalkInSlot,
} from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { ApiError } from "@/core/lib/api-error"
import { PRIVACY_NOTICE_TEXT } from "@/features/auth/privacy-notice/lib/privacy-notice"
import { BookingCheckoutError, BookingFormError } from "@/features/bookings/api/bookings.hooks"
import {
	useAddWalkInClientEmailMutation,
	useCreateWalkInBookingMutation,
	useCreateWalkInClientMutation,
	useWalkInClientLookupQuery,
	useWalkInFormQuery,
	useWalkInPoliciesQuery,
	useWalkInSlotsQuery,
	WALK_IN_FORM_UPLOAD_PATH,
	WalkInDuplicateClientError,
	walkInKeys,
} from "@/features/bookings/api/walk-in.hooks"
import {
	BookingFeeLines,
	feeLinesFromItems,
} from "@/features/bookings/components/booking-fee-lines"
import { BookingPolicies } from "@/features/bookings/components/booking-policies"
import {
	canChooseWalkInSlot,
	checkWalkInClientDraft,
	clientEmailLabel,
	draftFromLookup,
	EMPTY_WALK_IN_CLIENT,
	placesLeftLabel,
	walkInLookupKind,
	type WalkInClientDraft,
	type WalkInDraftErrors,
} from "@/features/bookings/lib/walk-in"
import { QuestionnaireFields } from "@/features/forms/components/questionnaire-fields"
import { formatPolicyDate, missingAcceptances } from "@/features/policies/lib/policy-documents"
import {
	dateLabel,
	manilaDateKey,
	manilaTime,
	slotTimeRange,
} from "@/features/schedules/lib/calendar"
import { useAvailableServicesQuery } from "@/features/services/api/services.hooks"
import { feeInPesos } from "@/features/services/lib/fee"

const STEPS = ["Client", "Service", "Time", "Questions", "Review", "Done"] as const
const STEP_CLIENT = 0
const STEP_SERVICE = 1
const STEP_SLOT = 2
const STEP_QUESTIONS = 3
const STEP_REVIEW = 4
const STEP_DONE = 5

const choiceClassName =
	"border-border hover:bg-muted/60 focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:bg-primary/5 w-full rounded-lg border p-4 text-left outline-none transition-colors focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60"

type DraftErrors = WalkInDraftErrors
/** The text fields of the new-client form. */
type DraftTextField = Exclude<keyof WalkInClientDraft, "privacyAccepted">

function newIdempotencyKey(): string {
	return crypto.randomUUID()
}

function pesos(centavos: number): string {
	return `₱${Number(feeInPesos(centavos)).toLocaleString("en-PH", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`
}

/**
 * Walk-in encoding (PRC-2, Annex A): a Processing Officer finds the client by
 * email or mobile number, or creates their account (no password: the client
 * is emailed an invitation to set one; a client with only a mobile number gets
 * no email until one is added, PRC-2b), records that the client accepted the
 * Privacy Notice, picks a Service and one of today's
 * slots at the officer's Location, answers the questionnaire with the client,
 * has the client read and accept the policies, and confirms. The Booking is
 * a walk-in awaiting payment; the client pays at the cashier.
 *
 * Hydration-safe: the service list shows its loading line on the server and
 * on the first client render.
 */
export function WalkInView() {
	const hydrated = useHydrated()
	const queryClient = useQueryClient()

	const [step, setStep] = useState(STEP_CLIENT)
	const [lookupText, setLookupText] = useState("")
	const [lookup, setLookup] = useState<string | null>(null)
	const [creating, setCreating] = useState(false)
	const [draft, setDraft] = useState<WalkInClientDraft>(EMPTY_WALK_IN_CLIENT)
	const [draftErrors, setDraftErrors] = useState<DraftErrors>({})
	const [client, setClient] = useState<WalkInClient | null>(null)
	const [serviceId, setServiceId] = useState<number | null>(null)
	const [slot, setSlot] = useState<WalkInSlot | null>(null)
	const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>({})
	const [formErrors, setFormErrors] = useState<Record<string, string>>({})
	const [formProblem, setFormProblem] = useState<string | null>(null)
	const [acceptedPolicyIds, setAcceptedPolicyIds] = useState<ReadonlySet<number>>(() => new Set())
	const [booking, setBooking] = useState<Booking | null>(null)
	const [clientKey, setClientKey] = useState(newIdempotencyKey)
	const [bookingKey, setBookingKey] = useState(newIdempotencyKey)

	const lookupQuery = useWalkInClientLookupQuery(lookup)
	const createClient = useCreateWalkInClientMutation()
	const services = useAvailableServicesQuery()
	const slots = useWalkInSlotsQuery(step >= STEP_SLOT && step < STEP_DONE ? serviceId : null)
	const form = useWalkInFormQuery(step >= STEP_SLOT && step < STEP_DONE ? serviceId : null)
	const policies = useWalkInPoliciesQuery(step === STEP_REVIEW ? serviceId : null)
	const createBooking = useCreateWalkInBookingMutation()

	const service = services.data?.find(item => item.id === serviceId) ?? null
	const servicesLoading = !hydrated || services.isPending || (!services.isError && !services.data)
	const location = slots.data?.location ?? null
	const stillToAccept = missingAcceptances(policies.data ?? [], acceptedPolicyIds)
	const forbidden = [lookupQuery.error, slots.error].some(
		error => error instanceof ApiError && error.status === 403
	)

	function search(event: FormEvent) {
		event.preventDefault()
		if (!walkInLookupKind(lookupText)) {
			toast.error("Enter the client's full email address or mobile number")
			return
		}
		setCreating(false)
		setLookup(lookupText.trim())
	}

	function chooseClient(chosen: WalkInClient) {
		setClient(chosen)
		setCreating(false)
		setStep(STEP_SERVICE)
	}

	function startCreating() {
		setDraft(draftFromLookup(lookupText))
		setDraftErrors({})
		setCreating(true)
	}

	function setDraftField(field: DraftTextField, value: string) {
		setDraft(current => ({ ...current, [field]: value }))
		setDraftErrors(current => ({ ...current, [field]: undefined }))
	}

	function setPrivacyAccepted(accepted: boolean) {
		setDraft(current => ({ ...current, privacyAccepted: accepted }))
		setDraftErrors(current => ({ ...current, privacyAccepted: undefined }))
	}

	async function submitNewClient(event: FormEvent) {
		event.preventDefault()
		const checked = checkWalkInClientDraft(draft)
		if (!checked.ok) {
			setDraftErrors(checked.errors)
			return
		}
		const input = checked.input
		try {
			const created = await createClient.mutateAsync({ ...input, idempotencyKey: clientKey })
			setClientKey(newIdempotencyKey())
			toast.success(
				created.email
					? `Account created. ${created.email} was sent an invitation to set a password.`
					: "Account created. No email was sent: add the client's email address when they have one."
			)
			chooseClient(created)
		} catch (error) {
			setClientKey(newIdempotencyKey())
			if (error instanceof WalkInDuplicateClientError) {
				// The client already has an account: show it so the officer selects it.
				toast.error(error.message)
				const matched =
					error.matchedBy === "mobile" && input.mobile
						? input.mobile
						: (input.email ?? input.mobile ?? "")
				setCreating(false)
				setLookupText(matched)
				setLookup(matched)
				return
			}
			toast.error(error instanceof Error ? error.message : "Could not create the account")
		}
	}

	function chooseService(id: number) {
		if (id !== serviceId) {
			setSlot(null)
			setAnswers({})
			setFormErrors({})
			setAcceptedPolicyIds(new Set())
		}
		setServiceId(id)
		setStep(STEP_SLOT)
	}

	function continueFromSlot() {
		if (!slot) return
		setFormProblem(null)
		setStep(form.data ? STEP_QUESTIONS : STEP_REVIEW)
	}

	function setAnswer(fieldId: string, value: FormAnswerValue) {
		setAnswers(current => ({ ...current, [fieldId]: value }))
		setFormErrors(current => {
			if (!current[fieldId]) return current
			const rest = { ...current }
			delete rest[fieldId]
			return rest
		})
	}

	/** The checked answers, null when some need fixing, undefined when there is no questionnaire. */
	function checkedForm(): BookingItemFormInput | null | undefined {
		if (!form.data) return undefined
		const result = checkFormAnswers(form.data.fields, answers)
		if (!result.ok) {
			setFormErrors(result.fieldErrors)
			return null
		}
		setFormErrors({})
		return { formTemplateId: form.data.formTemplateId, answers: result.answers }
	}

	function continueFromQuestions() {
		if (checkedForm() === null) {
			toast.error("Some answers need fixing")
			return
		}
		setStep(STEP_REVIEW)
	}

	function setPolicyAccepted(policyId: number, accepted: boolean) {
		setAcceptedPolicyIds(current => {
			const next = new Set(current)
			if (accepted) next.add(policyId)
			else next.delete(policyId)
			return next
		})
	}

	async function confirm() {
		if (!client || !slot) return
		const checked = checkedForm()
		if (checked === null) {
			setStep(STEP_QUESTIONS)
			return
		}
		try {
			const shownIds = new Set((policies.data ?? []).map(policy => policy.id))
			const created = await createBooking.mutateAsync({
				clientId: client.id,
				items: [{ scheduleSlotId: slot.id, ...(checked ? { form: checked } : {}) }],
				acceptedPolicyDocumentIds: [...acceptedPolicyIds].filter(id => shownIds.has(id)),
				idempotencyKey: bookingKey,
			})
			setBooking(created)
			setStep(STEP_DONE)
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not complete the booking"
			toast.error(message)
			setBookingKey(newIdempotencyKey())
			setAcceptedPolicyIds(new Set())
			if (error instanceof BookingFormError) {
				if (error.formChanged) void queryClient.invalidateQueries({ queryKey: walkInKeys.all })
				setFormErrors(error.fieldErrors)
				setFormProblem(message)
				setStep(STEP_QUESTIONS)
			} else if (error instanceof BookingCheckoutError) {
				setSlot(null)
				void slots.refetch()
				setStep(STEP_SLOT)
			}
		}
	}

	function startOver() {
		setStep(STEP_CLIENT)
		setLookupText("")
		setLookup(null)
		setCreating(false)
		setDraft(EMPTY_WALK_IN_CLIENT)
		setDraftErrors({})
		setClient(null)
		setServiceId(null)
		setSlot(null)
		setAnswers({})
		setFormErrors({})
		setFormProblem(null)
		setAcceptedPolicyIds(new Set())
		setBooking(null)
		setBookingKey(newIdempotencyKey())
	}

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				icon={UserGroupIcon}
				title="Walk-in"
				description="Encode a client who came to the office and book them into today's schedule. They pay at the cashier."
			/>

			<ol className="flex flex-wrap gap-2 text-sm" aria-label="Steps">
				{STEPS.map((label, index) => (
					<li key={label}>
						<Badge
							variant={index === step ? "default" : index < step ? "secondary" : "outline"}
							aria-current={index === step ? "step" : undefined}
						>
							{index + 1}. {label}
						</Badge>
					</li>
				))}
			</ol>

			{forbidden ? (
				<Problem message="Your account cannot encode walk-ins. Ask an administrator for the Processing Officer role." />
			) : null}

			{client && step > STEP_CLIENT && step < STEP_DONE ? (
				<div className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
					<div className="min-w-0">
						<p className="font-medium">{client.name}</p>
						<p className="text-muted-foreground text-sm">
							{clientEmailLabel(client.email)}
							{client.mobile ? ` · ${client.mobile}` : ""}
						</p>
					</div>
					<div className="flex items-center gap-2">
						{client.invitationPending && client.email ? (
							<Badge variant="outline">Invitation sent</Badge>
						) : null}
						<Button type="button" variant="outline" size="sm" onClick={startOver}>
							Change client
						</Button>
					</div>
					{client.email === null ? (
						<AddClientEmail clientId={client.id} onAdded={updated => setClient(updated)} />
					) : null}
				</div>
			) : null}

			{step === STEP_CLIENT ? (
				<div className="flex flex-col gap-4">
					<form
						onSubmit={search}
						className="bg-card flex flex-wrap items-end gap-3 rounded-xl border p-4"
					>
						<div className="flex min-w-0 flex-1 basis-64 flex-col gap-2">
							<Label htmlFor="walk-in-lookup">Client&apos;s email address or mobile number</Label>
							<Input
								id="walk-in-lookup"
								value={lookupText}
								onChange={event => setLookupText(event.target.value)}
								placeholder="juan@example.com or 0917 123 4567"
								autoComplete="off"
								autoFocus
							/>
						</div>
						<Button type="submit" disabled={lookupQuery.isFetching}>
							<HugeiconsIcon icon={Search01Icon} strokeWidth={2} data-icon="inline-start" />
							{lookupQuery.isFetching ? "Searching…" : "Find client"}
						</Button>
					</form>

					{lookup !== null && !creating ? (
						lookupQuery.isPending ? (
							<p className="text-muted-foreground text-sm" role="status">
								Searching…
							</p>
						) : lookupQuery.isError ? (
							<Problem
								message={lookupQuery.error.message}
								onRetry={() => void lookupQuery.refetch()}
							/>
						) : (lookupQuery.data ?? []).length === 0 ? (
							<div className="flex flex-col gap-3 rounded-xl border p-4">
								<p className="text-sm">
									No client account has this email address or mobile number.
								</p>
								<div>
									<Button type="button" onClick={startCreating}>
										Create the client&apos;s account
									</Button>
								</div>
							</div>
						) : (
							<div className="flex flex-col gap-2">
								{(lookupQuery.data ?? []).map(found => (
									<button
										key={found.id}
										type="button"
										className={choiceClassName}
										onClick={() => chooseClient(found)}
									>
										<span className="flex flex-wrap items-center justify-between gap-2">
											<span className="font-medium">{found.name}</span>
											{found.invitationPending ? (
												<Badge variant="outline">Has not set a password yet</Badge>
											) : null}
										</span>
										<span className="text-muted-foreground block text-sm">
											{clientEmailLabel(found.email)}
											{found.mobile ? ` · ${found.mobile}` : ""}
											{found.birthDate ? ` · born ${formatPolicyDate(found.birthDate)}` : ""}
										</span>
									</button>
								))}
								<p className="text-muted-foreground text-sm">
									Check the client&apos;s ID before selecting their account.
								</p>
							</div>
						)
					) : null}

					{creating ? (
						<form
							onSubmit={event => void submitNewClient(event)}
							className="bg-card flex flex-col gap-4 rounded-xl border p-4"
							aria-label="New client account"
							noValidate
						>
							<div>
								<h2 className="text-lg font-semibold">New client account</h2>
								<p className="text-muted-foreground text-sm">
									Copy the details from the client&apos;s ID. The client is emailed a link to set
									their own password; you never set it. A client with no email address needs a
									mobile number; they get no email until one is added.
								</p>
							</div>
							<div className="grid gap-4 sm:grid-cols-2">
								<DraftField
									id="name"
									label="Full name"
									draft={draft}
									errors={draftErrors}
									onChange={setDraftField}
									autoComplete="off"
								/>
								<DraftField
									id="email"
									label="Email address (optional)"
									type="email"
									draft={draft}
									errors={draftErrors}
									onChange={setDraftField}
									hint="The invitation goes here. Leave empty if the client has none."
								/>
								<DraftField
									id="mobile"
									label="Mobile number"
									type="tel"
									draft={draft}
									errors={draftErrors}
									onChange={setDraftField}
									hint="Required when the client has no email address."
								/>
								<DraftField
									id="birthDate"
									label="Birth date"
									type="date"
									draft={draft}
									errors={draftErrors}
									onChange={setDraftField}
								/>
								<DraftField
									id="nationality"
									label="Nationality"
									draft={draft}
									errors={draftErrors}
									onChange={setDraftField}
								/>
								<DraftField
									id="gender"
									label="Gender"
									draft={draft}
									errors={draftErrors}
									onChange={setDraftField}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<p
									id="walk-in-privacy-notice"
									className="bg-muted rounded-lg p-3 text-xs leading-relaxed"
								>
									{PRIVACY_NOTICE_TEXT}
								</p>
								<div className="flex items-start gap-3">
									<input
										id="walk-in-client-privacyAccepted"
										type="checkbox"
										className="accent-primary mt-1 size-4 shrink-0"
										checked={draft.privacyAccepted}
										onChange={event => setPrivacyAccepted(event.target.checked)}
										aria-describedby={
											draftErrors.privacyAccepted
												? "walk-in-privacy-notice walk-in-client-privacyAccepted-error"
												: "walk-in-privacy-notice"
										}
										aria-invalid={draftErrors.privacyAccepted ? true : undefined}
										required
									/>
									<Label htmlFor="walk-in-client-privacyAccepted" className="leading-snug">
										Client accepted the Privacy Notice
									</Label>
								</div>
								{draftErrors.privacyAccepted ? (
									<p id="walk-in-client-privacyAccepted-error" className="text-destructive text-sm">
										{draftErrors.privacyAccepted}
									</p>
								) : (
									<p className="text-muted-foreground text-xs">
										Let the client read the notice above. Tick this only after they accept it.
									</p>
								)}
							</div>
							<div className="flex justify-between gap-2">
								<Button type="button" variant="outline" onClick={() => setCreating(false)}>
									Cancel
								</Button>
								<Button type="submit" disabled={createClient.isPending || !draft.privacyAccepted}>
									{createClient.isPending ? "Creating…" : "Create account and continue"}
								</Button>
							</div>
						</form>
					) : null}
				</div>
			) : null}

			{step === STEP_SERVICE ? (
				<div className="flex flex-col gap-3">
					<h2 className="text-lg font-semibold">Choose the service</h2>
					{servicesLoading ? (
						<p className="text-muted-foreground text-sm" role="status">
							Loading services…
						</p>
					) : services.isError ? (
						<Problem
							message="The services could not be loaded."
							onRetry={() => void services.refetch()}
						/>
					) : (
						<div className="grid gap-2 sm:grid-cols-2">
							{(services.data ?? []).map(item => (
								<button
									key={item.id}
									type="button"
									className={choiceClassName}
									aria-pressed={item.id === serviceId}
									onClick={() => chooseService(item.id)}
								>
									<span className="block font-medium">{item.name}</span>
									<span className="text-muted-foreground block text-sm">
										{item.categoryName} · {pesos(item.feeCentavos)}
									</span>
								</button>
							))}
						</div>
					)}
					<Actions onBack={() => setStep(STEP_CLIENT)} />
				</div>
			) : null}

			{step === STEP_SLOT && service ? (
				<div className="flex flex-col gap-3">
					<h2 className="text-lg font-semibold">Choose today&apos;s slot</h2>
					{slots.isPending ? (
						<p className="text-muted-foreground text-sm" role="status">
							Loading today&apos;s slots…
						</p>
					) : slots.isError ? (
						<Problem message={slots.error.message} onRetry={() => void slots.refetch()} />
					) : !location ? (
						<Problem message="Your account has no Location, so walk-ins cannot be booked. Ask an administrator to give you one." />
					) : (
						<>
							<p className="text-muted-foreground text-sm">
								{service.name} at {location.name}, {dateLabel(slots.data?.date ?? "")}.
							</p>
							{(slots.data?.slots ?? []).length === 0 ? (
								<p className="text-sm">
									There are no more slots for this service here today. Choose another service, or
									ask the client to book online for another day.
								</p>
							) : (
								<div className="grid gap-2 sm:grid-cols-2">
									{(slots.data?.slots ?? []).map(item => (
										<button
											key={item.id}
											type="button"
											className={choiceClassName}
											aria-pressed={item.id === slot?.id}
											disabled={!canChooseWalkInSlot(item)}
											onClick={() => setSlot(item)}
										>
											<span className="flex flex-wrap items-center justify-between gap-2">
												<span className="font-medium">{slotTimeRange(item)}</span>
												{item.inProgress ? <Badge variant="secondary">In progress</Badge> : null}
											</span>
											<span className="text-muted-foreground block text-sm">
												{placesLeftLabel(item)}
											</span>
										</button>
									))}
								</div>
							)}
						</>
					)}
					<Actions
						onBack={() => setStep(STEP_SERVICE)}
						onNext={continueFromSlot}
						nextDisabled={!slot || form.isPending || form.isError}
					/>
					{form.isError ? (
						<Problem
							message="The questionnaire could not be loaded."
							onRetry={() => void form.refetch()}
						/>
					) : null}
				</div>
			) : null}

			{step === STEP_QUESTIONS && service && form.data ? (
				<div className="flex flex-col gap-4">
					<h2 className="text-lg font-semibold">Answer the questions with the client</h2>
					<p className="text-muted-foreground text-sm">Questions marked * are required.</p>
					{formProblem ? (
						<div
							className="border-destructive/30 bg-destructive/5 rounded-lg border p-4"
							role="alert"
						>
							<p className="text-sm font-medium">Nothing was booked yet.</p>
							<p className="text-muted-foreground mt-1 text-sm">{formProblem}</p>
						</div>
					) : null}
					<section
						className="border-border flex flex-col gap-4 rounded-lg border p-4"
						aria-label={`Questions for ${service.name}`}
					>
						<h3 className="font-medium">{service.name}</h3>
						<QuestionnaireFields
							form={form.data}
							values={answers}
							errors={formErrors}
							onChange={setAnswer}
							idPrefix="walk-in"
							uploadPath={WALK_IN_FORM_UPLOAD_PATH}
						/>
					</section>
					<Actions
						onBack={() => setStep(STEP_SLOT)}
						onNext={continueFromQuestions}
						nextLabel="Review"
					/>
				</div>
			) : null}

			{step === STEP_REVIEW && service && slot && location && client ? (
				<div className="flex flex-col gap-3">
					<h2 className="text-lg font-semibold">Review with the client</h2>
					<div className="border-border rounded-lg border p-4">
						<BookingFeeLines
							lines={[
								{
									key: slot.id,
									serviceName: service.name,
									detail: `${location.name} · today · ${slotTimeRange(slot)}`,
									feeCentavos: service.feeCentavos,
								},
							]}
							totalCentavos={service.feeCentavos}
						/>
					</div>
					<p className="text-muted-foreground text-sm">
						Let the client read the terms below. Tick each one only after the client accepts it.
					</p>
					<BookingPolicies
						policies={policies.data ?? []}
						loading={policies.isPending}
						failed={policies.isError}
						onRetry={() => void policies.refetch()}
						accepted={acceptedPolicyIds}
						onAcceptedChange={setPolicyAccepted}
					/>
					<Actions
						onBack={() => setStep(form.data ? STEP_QUESTIONS : STEP_SLOT)}
						onNext={() => void confirm()}
						nextLabel={createBooking.isPending ? "Booking…" : "Confirm booking"}
						nextDisabled={
							createBooking.isPending || !policies.isSuccess || stillToAccept.length > 0
						}
					/>
				</div>
			) : null}

			{step === STEP_DONE && booking ? (
				<div className="flex flex-col gap-4" role="status">
					<h2 className="text-lg font-semibold">Booked. Send the client to the cashier.</h2>
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
							<div className="flex flex-wrap gap-2">
								<Badge variant="secondary">Pending payment</Badge>
								<Badge variant="outline">Walk-in</Badge>
							</div>
							<BookingFeeLines
								lines={feeLinesFromItems(booking.items)}
								totalCentavos={booking.totalCentavos}
							/>
							{booking.holdExpiresAt ? (
								<p className="text-sm">
									The cashier must collect the payment by{" "}
									<span className="font-medium">
										{manilaTime(booking.holdExpiresAt)} on{" "}
										{dateLabel(manilaDateKey(booking.holdExpiresAt))}
									</span>
									, or the place is released.
								</p>
							) : null}
						</div>
					</div>
					<p className="text-muted-foreground text-sm">
						The cashier finds this booking by its Reference Number, QR code or the client&apos;s
						email.
					</p>
					<div>
						<Button type="button" onClick={startOver}>
							Next walk-in
						</Button>
					</div>
				</div>
			) : null}
		</section>
	)
}

function DraftField({
	id,
	label,
	type = "text",
	draft,
	errors,
	onChange,
	hint,
	autoComplete = "off",
}: {
	id: DraftTextField
	label: string
	type?: "text" | "email" | "tel" | "date"
	draft: WalkInClientDraft
	errors: DraftErrors
	onChange: (field: DraftTextField, value: string) => void
	hint?: string
	autoComplete?: string
}) {
	const inputId = `walk-in-client-${id}`
	const error = errors[id]
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={inputId}>{label}</Label>
			<Input
				id={inputId}
				type={type}
				value={draft[id]}
				autoComplete={autoComplete}
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? `${inputId}-error` : undefined}
				onChange={event => onChange(id, event.target.value)}
			/>
			{hint && !error ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
			{error ? (
				<p id={`${inputId}-error`} className="text-destructive text-sm">
					{error}
				</p>
			) : null}
		</div>
	)
}

/**
 * PRC-2b: give a client who has no email address a real one. It replaces the
 * placeholder, and the invitation to set a password is emailed.
 */
function AddClientEmail({
	clientId,
	onAdded,
}: {
	clientId: string
	onAdded: (client: WalkInClient) => void
}) {
	const [email, setEmail] = useState("")
	const [error, setError] = useState<string | null>(null)
	const addEmail = useAddWalkInClientEmailMutation()

	async function submit(event: FormEvent) {
		event.preventDefault()
		const value = email.trim().toLowerCase()
		if (walkInLookupKind(value) !== "email") {
			setError("Enter a valid email address")
			return
		}
		try {
			const updated = await addEmail.mutateAsync({ clientId, email: value })
			setEmail("")
			setError(null)
			toast.success(
				updated.invitationPending
					? `Email added. ${value} was sent an invitation to set a password.`
					: "Email added."
			)
			onAdded(updated)
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Could not add the email address")
		}
	}

	return (
		<form
			onSubmit={event => void submit(event)}
			className="flex w-full flex-wrap items-end gap-3 border-t pt-3"
			aria-label="Add the client's email address"
			noValidate
		>
			<div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
				<Label htmlFor="walk-in-add-email">Add the client&apos;s email address</Label>
				<Input
					id="walk-in-add-email"
					type="email"
					value={email}
					autoComplete="off"
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? "walk-in-add-email-error" : undefined}
					onChange={event => {
						setEmail(event.target.value)
						setError(null)
					}}
				/>
				{error ? (
					<p id="walk-in-add-email-error" className="text-destructive text-sm">
						{error}
					</p>
				) : (
					<p className="text-muted-foreground text-xs">
						The client has no email yet. The invitation to set a password goes here.
					</p>
				)}
			</div>
			<Button type="submit" variant="outline" disabled={addEmail.isPending}>
				{addEmail.isPending ? "Saving…" : "Add email"}
			</Button>
		</form>
	)
}

function Problem({ message, onRetry }: { message: string; onRetry?: () => void }) {
	return (
		<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4" role="alert">
			<p className="text-sm">{message}</p>
			{onRetry ? (
				<Button className="mt-3" variant="outline" onClick={onRetry}>
					Retry
				</Button>
			) : null}
		</div>
	)
}

function Actions({
	onBack,
	onNext,
	nextLabel = "Continue",
	nextDisabled,
}: {
	onBack?: () => void
	onNext?: () => void
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
			{onNext ? (
				<Button type="button" onClick={onNext} disabled={nextDisabled}>
					{nextLabel}
				</Button>
			) : null}
		</div>
	)
}
