import { oc } from "@orpc/contract"
import { z } from "zod"

import {
	ActiveAnnouncementSchema,
	AnnouncementMediaUploadSchema,
	AnnouncementSchema,
	CreateAnnouncementSchema,
	SetAnnouncementActiveSchema,
	UpdateAnnouncementSchema,
	UploadAnnouncementMediaSchema,
} from "./announcements.schema.js"

/**
 * AUTH-4: the Gender and Development flash screen shown before client sign-in.
 * Every admin route requires settings.announcements:manage. The media bytes
 * are plain routes: GET /v1/announcements/{id}/media (public while showing)
 * and GET /v1/announcements/{id}/media/preview (admins).
 */
export const announcementsContract = {
	list: oc
		.route({
			method: "GET",
			path: "/announcements",
			summary: "List announcements",
			description:
				"Every Announcement, newest start first. Requires settings.announcements:manage.",
			tags: ["Announcements"],
		})
		.output(z.array(AnnouncementSchema)),

	uploadMedia: oc
		.route({
			method: "POST",
			path: "/announcements/media",
			summary: "Upload an announcement image or video",
			description:
				"JPG or PNG up to 5 MB, MP4 up to 20 MB, checked from the bytes. Returns the key to save with the Announcement. Audited. Requires settings.announcements:manage.",
			tags: ["Announcements"],
		})
		.input(UploadAnnouncementMediaSchema)
		.output(AnnouncementMediaUploadSchema),

	create: oc
		.route({
			method: "POST",
			path: "/announcements",
			summary: "Create an announcement",
			description:
				"Stores a new, inactive Announcement and audits it. Requires settings.announcements:manage.",
			tags: ["Announcements"],
		})
		.input(CreateAnnouncementSchema)
		.output(AnnouncementSchema),

	update: oc
		.route({
			method: "PUT",
			path: "/announcements/{id}",
			summary: "Edit an announcement",
			description:
				"Changes the title, file or schedule. Audited with the old and new values. Requires settings.announcements:manage.",
			tags: ["Announcements"],
		})
		.input(UpdateAnnouncementSchema)
		.output(AnnouncementSchema),

	setActive: oc
		.route({
			method: "PATCH",
			path: "/announcements/{id}/active",
			summary: "Activate or deactivate an announcement",
			description: "Audited. Requires settings.announcements:manage.",
			tags: ["Announcements"],
		})
		.input(SetAnnouncementActiveSchema)
		.output(AnnouncementSchema),

	active: oc
		.route({
			method: "GET",
			path: "/announcements/active",
			summary: "The announcement to show before sign-in",
			description:
				"Public, no session. The active Announcement inside its date range with the newest start, or null. Rate limited.",
			tags: ["Announcements"],
		})
		.output(ActiveAnnouncementSchema.nullable()),
}
