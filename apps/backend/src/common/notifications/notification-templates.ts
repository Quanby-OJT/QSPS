import type { NotificationTemplate } from "./notification.service"

const messages: Record<NotificationTemplate, [string, string]> = {
	booking_confirmed: [
		"Booking confirmed",
		"Your booking has been recorded. Sign in to view your appointment and payment details.",
	],
	payment_received: [
		"Payment received",
		"We have received your payment. Your electronic receipt and booking QR are attached.",
	],
	payment_received_review: [
		"Payment received",
		"We have received your payment, but it could not be applied to your booking. BOQ staff will review it and contact you. Your electronic receipt is attached.",
	],
	// PAY-6: a second payment for a booking that was already paid. No second
	// receipt is issued, so none is attached.
	payment_duplicate_review: [
		"Payment received",
		"We have received a second payment for a booking that was already paid. BOQ staff will review it and contact you about a refund or a new booking.",
	],
	booking_cancelled: ["Booking cancelled", "Your booking has been cancelled."],
	booking_rescheduled: [
		"Booking rescheduled",
		"Sign in to view your updated appointment schedule.",
	],
	expedite_decision: [
		"Expedite decision available",
		"A decision on your expedite request is available in your account.",
	],
	assessment_returned: ["Assessment returned", "Your assessment requires your attention."],
	assessment_rejected: ["Assessment rejected", "Sign in to view your assessment details."],
	document_ready: ["Document ready", "Your document is ready. Sign in to view or download it."],
	// CRT-8
	document_revoked: [
		"Document revoked",
		"One of your documents has been revoked by BOQ and is no longer valid. Sign in to see your documents.",
	],
	document_reissued: [
		"Document reissued",
		"BOQ has reissued one of your documents with corrected details. The old one is no longer valid. Sign in to view or download the new one.",
	],
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
}

export function renderNotification(template: string, referenceNumber: string) {
	if (!Object.hasOwn(messages, template)) {
		throw new Error("Unknown notification template")
	}

	const [title, message] = messages[template as NotificationTemplate]

	return {
		subject: `BOQ QSPS — ${title}`,
		text: `${title}\n\n${message}\n\nBooking reference: ${referenceNumber}`,
		html: `<!doctype html>
<html>
<body style="font-family:Arial,sans-serif">
	<h2>${escapeHtml(title)}</h2>
	<p>${escapeHtml(message)}</p>
	<p>Booking reference: ${escapeHtml(referenceNumber)}</p>
</body>
</html>`,
	}
}
