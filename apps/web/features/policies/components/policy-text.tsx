import { policyParagraphs } from "@/features/policies/lib/policy-documents"

/** A policy's text as paragraphs. React escapes it, so it is never read as HTML. */
export function PolicyText({ body, className }: { body: string; className?: string }) {
	return (
		<div className={className}>
			{policyParagraphs(body).map((paragraph, index) => (
				<p
					key={index}
					className="whitespace-pre-line text-sm leading-relaxed [&:not(:first-child)]:mt-3"
				>
					{paragraph}
				</p>
			))}
		</div>
	)
}
