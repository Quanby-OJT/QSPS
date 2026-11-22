import type { PolicyDocumentSummary } from "@repo/contracts"

import { Button } from "@/core/components/ui/button"
import { PolicyText } from "@/features/policies/components/policy-text"

/**
 * ADM-9: the written policies on the booking review step. A policy that
 * requires acceptance has a checkbox; the others are for reading. The API
 * checks the same thing again when the booking is confirmed.
 */
export function BookingPolicies({
	policies,
	loading,
	failed,
	onRetry,
	accepted,
	onAcceptedChange,
}: {
	policies: readonly PolicyDocumentSummary[]
	loading: boolean
	failed: boolean
	onRetry: () => void
	accepted: ReadonlySet<number>
	onAcceptedChange: (policyId: number, accepted: boolean) => void
}) {
	if (loading) {
		return (
			<p className="text-muted-foreground text-sm" role="status">
				Loading booking terms…
			</p>
		)
	}
	if (failed) {
		return (
			<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
				<p className="text-sm font-medium">Could not load the booking terms.</p>
				<p className="text-muted-foreground mt-1 text-sm">You can confirm once they have loaded.</p>
				<Button className="mt-3" variant="outline" onClick={onRetry}>
					Retry
				</Button>
			</div>
		)
	}
	if (policies.length === 0) return null

	return (
		<section className="flex flex-col gap-3" aria-labelledby="booking-terms-heading">
			<h3 id="booking-terms-heading" className="font-semibold">
				Booking terms
			</h3>
			{policies.map(policy => (
				<div key={policy.id} className="border-border rounded-lg border p-4">
					<p className="font-medium">{policy.title}</p>
					<PolicyText
						body={policy.body}
						className="bg-muted/40 mt-2 max-h-48 overflow-y-auto rounded-md p-3"
					/>
					{policy.requiresAcceptance ? (
						<label className="mt-3 flex items-start gap-2 text-sm">
							<input
								type="checkbox"
								checked={accepted.has(policy.id)}
								onChange={event => onAcceptedChange(policy.id, event.target.checked)}
								className="accent-primary mt-0.5 size-4 shrink-0"
							/>
							<span>I have read and accept “{policy.title}”.</span>
						</label>
					) : (
						<p className="text-muted-foreground mt-3 text-xs">For your information.</p>
					)}
				</div>
			))}
		</section>
	)
}
