import { describe, expect, it } from "vitest"

import { contactChannels } from "./contact-channels"

describe("contactChannels (ADM-8)", () => {
	it("shows nothing when no channel is set", () => {
		expect(contactChannels({ phone: null, email: null, ticketUrl: null, hours: null })).toEqual([])
	})

	it("lists only the set channels, in order, with where each one opens", () => {
		const channels = contactChannels({
			phone: "+63 (2) 8123-4567",
			email: null,
			ticketUrl: "https://help.example.gov.ph/tickets",
			hours: "Monday to Friday, 8:00 AM to 5:00 PM",
		})

		expect(channels.map(channel => channel.kind)).toEqual(["phone", "ticket", "hours"])
		expect(channels[0]).toMatchObject({ href: "tel:+63281234567", external: false })
		expect(channels[1]).toMatchObject({
			href: "https://help.example.gov.ph/tickets",
			external: true,
		})
		expect(channels[2]).toMatchObject({ href: null })
	})

	it("opens the email channel in the mail app", () => {
		const [email] = contactChannels({
			phone: null,
			email: "help@example.gov.ph",
			ticketUrl: null,
			hours: null,
		})
		expect(email).toMatchObject({ kind: "email", href: "mailto:help@example.gov.ph" })
	})
})
