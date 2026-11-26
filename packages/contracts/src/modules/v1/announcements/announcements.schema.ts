import { z } from "zod"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

/** Longest Announcement title. */
export const MAX_ANNOUNCEMENT_TITLE_LENGTH = 200

/**
 * Files an Announcement may show (AUTH-4): the extension each is stored under,
 * whether it is an image or a video, and its size limit. The API checks the
 * type from the file's bytes, not from what the browser declares.
 */
export const ANNOUNCEMENT_MEDIA_TYPES = {
	"image/jpeg": { extension: "jpg", mediaType: "image", maxBytes: 5 * 1024 * 1024 },
	"image/png": { extension: "png", mediaType: "image", maxBytes: 5 * 1024 * 1024 },
	"video/mp4": { extension: "mp4", mediaType: "video", maxBytes: 20 * 1024 * 1024 },
} as const

export type AnnouncementContentType = keyof typeof ANNOUNCEMENT_MEDIA_TYPES

export const ANNOUNCEMENT_CONTENT_TYPES = Object.keys(
	ANNOUNCEMENT_MEDIA_TYPES
) as AnnouncementContentType[]

export const ANNOUNCEMENT_MEDIA_KINDS = ["image", "video"] as const
export const AnnouncementMediaKindSchema = z.enum(ANNOUNCEMENT_MEDIA_KINDS)

/** Where an uploaded file is stored: a random name under `announcements/`. */
export const ANNOUNCEMENT_MEDIA_KEY_PATTERN =
	/^announcements\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|mp4)$/

export const AnnouncementMediaKeySchema = z
	.string()
	.regex(ANNOUNCEMENT_MEDIA_KEY_PATTERN, "Upload the image or video again")

/** Where an Announcement stands right now. */
export const ANNOUNCEMENT_STATES = ["showing", "scheduled", "ended", "inactive"] as const
export const AnnouncementStateSchema = z.enum(ANNOUNCEMENT_STATES)

/** The image or video, sent as multipart form data. */
export const UploadAnnouncementMediaSchema = z.object({ file: z.file() })

export const AnnouncementMediaUploadSchema = z.object({
	mediaKey: z.string(),
	mediaType: AnnouncementMediaKindSchema,
	contentType: z.string(),
	sizeBytes: z.number().int().nonnegative(),
})

const DateTimeSchema = z.iso.datetime({ offset: true, error: "Enter a date and time" })

const AnnouncementFieldsSchema = z.object({
	title: z
		.string()
		.trim()
		.min(1, "Enter a title")
		.max(
			MAX_ANNOUNCEMENT_TITLE_LENGTH,
			`Keep the title to ${MAX_ANNOUNCEMENT_TITLE_LENGTH} characters`
		),
	mediaKey: AnnouncementMediaKeySchema,
	startsAt: DateTimeSchema,
	/** Null: shown until deactivated. */
	endsAt: DateTimeSchema.nullable().default(null),
})

type AnnouncementFields = z.infer<typeof AnnouncementFieldsSchema>

/** An end, when given, comes after the start. */
function withDateRule<T extends z.ZodType<AnnouncementFields>>(schema: T) {
	return schema.refine(
		value => value.endsAt === null || new Date(value.endsAt) > new Date(value.startsAt),
		{ path: ["endsAt"], message: "The end must be after the start" }
	)
}

const AnnouncementIdSchema = z.coerce.number().int().positive()

/** A new Announcement. It starts inactive. Requires settings.announcements:manage. */
export const CreateAnnouncementSchema = withDateRule(AnnouncementFieldsSchema)

/** Every field sent again; a new mediaKey replaces the file (the old one is kept). */
export const UpdateAnnouncementSchema = withDateRule(
	AnnouncementFieldsSchema.extend({ id: AnnouncementIdSchema })
)

export const SetAnnouncementActiveSchema = z.object({
	id: AnnouncementIdSchema,
	isActive: z.boolean(),
})

/** One Announcement as the admin list shows it. Paths are relative to the API base (/api/v1). */
export const AnnouncementSchema = z.object({
	id: z.number().int().positive(),
	title: z.string(),
	mediaType: AnnouncementMediaKindSchema,
	/** Public file, served only while the Announcement is showing. */
	mediaPath: z.string(),
	/** The same file for admins, whatever its state. */
	previewPath: z.string(),
	/** The stored file key; sent back unchanged on edit to keep the file. */
	mediaKey: z.string(),
	startsAt: dateField,
	endsAt: dateField.nullable(),
	isActive: z.boolean(),
	state: AnnouncementStateSchema,
	createdByEmail: z.string().nullable(),
	createdAt: dateField,
	updatedAt: dateField,
})

/** What the sign-in page needs. Public. */
export const ActiveAnnouncementSchema = z.object({
	id: z.number().int().positive(),
	title: z.string(),
	mediaType: AnnouncementMediaKindSchema,
	mediaPath: z.string(),
	updatedAt: dateField,
})

export type AnnouncementMediaKind = z.infer<typeof AnnouncementMediaKindSchema>
export type AnnouncementState = z.infer<typeof AnnouncementStateSchema>
export type AnnouncementMediaUpload = z.infer<typeof AnnouncementMediaUploadSchema>
export type CreateAnnouncementInput = z.infer<typeof CreateAnnouncementSchema>
export type UpdateAnnouncementInput = z.infer<typeof UpdateAnnouncementSchema>
export type SetAnnouncementActiveInput = z.infer<typeof SetAnnouncementActiveSchema>
export type Announcement = z.infer<typeof AnnouncementSchema>
export type ActiveAnnouncement = z.infer<typeof ActiveAnnouncementSchema>
