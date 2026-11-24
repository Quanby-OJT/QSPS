"use client"

import {
	applicationFormDownloadUrl,
	useApplicationFormsQuery,
	type ApplicationFormLink,
} from "@/features/processing/api/printouts.hooks"

/** What the links show, without the request (tested on its own). */
export function ApplicationFormLinksView({ forms }: { forms: ApplicationFormLink[] }) {
	if (forms.length === 0) return null

	return (
		<div className="flex flex-col gap-1">
			<p className="text-muted-foreground text-sm">Application form</p>
			<ul className="flex flex-col gap-1">
				{forms.map(form => (
					<li key={form.bookingItemId}>
						<a
							href={applicationFormDownloadUrl(form.bookingItemId)}
							className="text-primary text-sm underline underline-offset-2"
							target="_blank"
							rel="noopener noreferrer"
						>
							Download the application form for {form.serviceName}
						</a>
					</li>
				))}
			</ul>
		</div>
	)
}

/**
 * CRT-4: the client's own application forms for one Booking, as download
 * links. Shows nothing while loading, when the Booking has no application
 * form, or when the list cannot be read.
 */
export function ApplicationFormLinks({ bookingId }: { bookingId: number }) {
	const forms = useApplicationFormsQuery(bookingId)
	if (!forms.data) return null
	return <ApplicationFormLinksView forms={forms.data} />
}
