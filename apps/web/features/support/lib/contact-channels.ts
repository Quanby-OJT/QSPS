import type { SupportContacts } from "@repo/contracts"

export type ContactChannelKind = "phone" | "email" | "ticket" | "hours"

export interface ContactChannel {
	kind: ContactChannelKind
	label: string
	value: string
	/** Where the channel opens; hours have none. */
	href: string | null
	/** True for a link that leaves QSPS, so it opens in a new tab. */
	external: boolean
}

/**
 * The channels the Help page shows, in display order (ADM-8). A channel with
 * no value is left out.
 */
export function contactChannels(contacts: SupportContacts): ContactChannel[] {
	const channels: ContactChannel[] = []
	if (contacts.phone) {
		channels.push({
			kind: "phone",
			label: "Call the help desk",
			value: contacts.phone,
			href: `tel:${contacts.phone.replace(/[^0-9+]/g, "")}`,
			external: false,
		})
	}
	if (contacts.email) {
		channels.push({
			kind: "email",
			label: "Email the help desk",
			value: contacts.email,
			href: `mailto:${contacts.email}`,
			external: false,
		})
	}
	if (contacts.ticketUrl) {
		channels.push({
			kind: "ticket",
			label: "Open a help desk ticket",
			value: contacts.ticketUrl,
			href: contacts.ticketUrl,
			external: true,
		})
	}
	if (contacts.hours) {
		channels.push({
			kind: "hours",
			label: "Support hours",
			value: contacts.hours,
			href: null,
			external: false,
		})
	}
	return channels
}
