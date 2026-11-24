"use client"

import { toast } from "sonner"

import { Button } from "@/core/components/ui/button"
import {
	usePrintApplicationFormMutation,
	usePrintRequestForPaymentMutation,
} from "@/features/processing/api/printouts.hooks"

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback
}

export interface PrintoutsPanelViewProps {
	/** The item is a Physical Examination Service and the user may print. */
	showApplicationForm: boolean
	/** The Booking awaits payment, has a Physical Examination item, and the user may print. */
	showRequestForPayment: boolean
	printingApplication: boolean
	printingRequest: boolean
	onPrintApplication: () => void
	onPrintRequest: () => void
}

/** What the panel shows, without the requests (tested on its own). */
export function PrintoutsPanelView({
	showApplicationForm,
	showRequestForPayment,
	printingApplication,
	printingRequest,
	onPrintApplication,
	onPrintRequest,
}: PrintoutsPanelViewProps) {
	if (!showApplicationForm && !showRequestForPayment) return null

	return (
		<fieldset className="flex flex-col gap-3 rounded-lg border p-3">
			<legend className="px-1 text-sm font-medium">Printouts</legend>
			<p className="text-muted-foreground text-xs">
				Printed from the client&apos;s booking. These are not issued documents and use no document
				number.
			</p>
			<div className="flex flex-wrap gap-2">
				{showApplicationForm ? (
					<Button
						type="button"
						variant="outline"
						onClick={onPrintApplication}
						disabled={printingApplication}
					>
						{printingApplication ? "Opening the form" : "Print application form"}
					</Button>
				) : null}
				{showRequestForPayment ? (
					<Button
						type="button"
						variant="outline"
						onClick={onPrintRequest}
						disabled={printingRequest}
					>
						{printingRequest ? "Opening the request" : "Print Request for Payment"}
					</Button>
				) : null}
			</div>
		</fieldset>
	)
}

export interface PrintoutsPanelProps {
	bookingId: number
	bookingItemId: number
	showApplicationForm: boolean
	showRequestForPayment: boolean
}

/** CRT-4: the staff buttons for the application form and the Request for Payment. */
export function PrintoutsPanel({
	bookingId,
	bookingItemId,
	showApplicationForm,
	showRequestForPayment,
}: PrintoutsPanelProps) {
	const application = usePrintApplicationFormMutation()
	const request = usePrintRequestForPaymentMutation()

	async function printApplication() {
		// Opened from the click itself, or pop-up blockers refuse the tab.
		const target = window.open("", "_blank")
		try {
			await application.mutateAsync({ bookingItemId, target })
			toast.success("Application form opened")
		} catch (error) {
			toast.error(errorMessage(error, "Could not print the application form"))
		}
	}

	async function printRequest() {
		const target = window.open("", "_blank")
		try {
			await request.mutateAsync({ bookingId, target })
			toast.success("Request for Payment opened")
		} catch (error) {
			toast.error(errorMessage(error, "Could not print the Request for Payment"))
		}
	}

	return (
		<PrintoutsPanelView
			showApplicationForm={showApplicationForm}
			showRequestForPayment={showRequestForPayment}
			printingApplication={application.isPending}
			printingRequest={request.isPending}
			onPrintApplication={() => void printApplication()}
			onPrintRequest={() => void printRequest()}
		/>
	)
}
