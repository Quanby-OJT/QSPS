import { z } from "zod"

/**
 * The help desk channels the Help pages show (ADM-8). Each comes from its
 * `support.*` Policy; a channel with no value is null, and the page leaves it
 * out.
 */
export const SupportContactsSchema = z.object({
	phone: z.string().nullable(),
	email: z.string().nullable(),
	ticketUrl: z.string().nullable(),
	hours: z.string().nullable(),
})

export type SupportContacts = z.infer<typeof SupportContactsSchema>
