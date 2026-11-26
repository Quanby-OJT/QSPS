import { Inject, Injectable } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { ORPCError } from "@orpc/server"
import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm"

import {
	ANNOUNCEMENT_MEDIA_KEY_PATTERN,
	ANNOUNCEMENT_MEDIA_TYPES,
	type ActiveAnnouncement,
	type Announcement,
	type AnnouncementContentType,
	type AnnouncementMediaKind,
	type AnnouncementMediaUpload,
	type CreateAnnouncementInput,
	type UpdateAnnouncementInput,
} from "@repo/contracts"
import { announcements, users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { FILE_STORAGE, type FileStorage } from "@/common/storage/file-storage"

import {
	announcementState,
	contentTypeOfKey,
	mediaPathOf,
	previewPathOf,
	sniffAnnouncementMedia,
	type AnnouncementRow,
} from "./announcement-rules"

/** Audit domain for admin settings changes, shared with ADM-6 and ADM-9. */
const AUDIT_DOMAIN_SETTINGS = "settings"

const MB = 1024 * 1024

function auditView(row: AnnouncementRow) {
	return {
		id: row.id,
		title: row.title,
		mediaUrl: row.mediaUrl,
		mediaType: row.mediaType,
		startsAt: row.startsAt.toISOString(),
		endsAt: row.endsAt ? row.endsAt.toISOString() : null,
		isActive: row.isActive,
	}
}

function toAnnouncement(
	row: AnnouncementRow,
	createdByEmail: string | null,
	now: Date
): Announcement {
	return {
		id: row.id,
		title: row.title,
		mediaType: row.mediaType,
		mediaKey: row.mediaUrl,
		mediaPath: mediaPathOf(row),
		previewPath: previewPathOf(row),
		startsAt: row.startsAt,
		endsAt: row.endsAt,
		isActive: row.isActive,
		state: announcementState(row, now),
		createdByEmail,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}
}

function requireActor(actorId: string | null): string {
	if (!actorId) {
		throw new ORPCError("UNAUTHORIZED", { message: "Sign in to manage announcements" })
	}
	return actorId
}

function notFound() {
	return new ORPCError("NOT_FOUND", { message: "This announcement was not found" })
}

/**
 * The Gender and Development flash screen (AUTH-4). The only code that writes
 * `announcements`. Rows are never deleted, only deactivated, and a replaced
 * file stays in storage. Every write is audited in the same transaction.
 */
@Injectable()
export class AnnouncementService {
	constructor(
		@Inject(FILE_STORAGE) private readonly storage: FileStorage,
		private readonly auditService: AuditService
	) {}

	/** Every Announcement for the admin list, newest start first. */
	async list(now: Date = new Date()): Promise<Announcement[]> {
		const rows = await db
			.select({ row: announcements, createdByEmail: users.email })
			.from(announcements)
			.leftJoin(users, eq(announcements.createdBy, users.id))
			.orderBy(desc(announcements.startsAt), desc(announcements.id))
		return rows.map(({ row, createdByEmail }) => toAnnouncement(row, createdByEmail ?? null, now))
	}

	/** The one to show before sign-in: active, inside its range, newest start. */
	async active(now: Date = new Date()): Promise<ActiveAnnouncement | null> {
		const [row] = await db
			.select()
			.from(announcements)
			.where(
				and(
					eq(announcements.isActive, true),
					lte(announcements.startsAt, now),
					or(isNull(announcements.endsAt), gt(announcements.endsAt, now))
				)
			)
			.orderBy(desc(announcements.startsAt), desc(announcements.id))
			.limit(1)
		if (!row) return null
		return {
			id: row.id,
			title: row.title,
			mediaType: row.mediaType,
			mediaPath: mediaPathOf(row),
			updatedAt: row.updatedAt,
		}
	}

	/** Store an image or video; the returned key is then saved with an Announcement. */
	async uploadMedia(file: File, actorId: string | null): Promise<AnnouncementMediaUpload> {
		const actor = requireActor(actorId)
		if (file.size === 0) throw new ORPCError("BAD_REQUEST", { message: "The file is empty" })

		const declared = ANNOUNCEMENT_MEDIA_TYPES[file.type as AnnouncementContentType]
		if (!declared) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Upload a JPG or PNG image, or an MP4 video",
			})
		}
		if (file.size > declared.maxBytes) {
			throw new ORPCError("BAD_REQUEST", {
				message: `${declared.mediaType === "video" ? "Videos" : "Images"} can be at most ${declared.maxBytes / MB} MB`,
			})
		}

		const bytes = new Uint8Array(await file.arrayBuffer())
		const contentType = sniffAnnouncementMedia(bytes)
		// The browser's declared type is a claim; the bytes must agree with it.
		if (!contentType || contentType !== file.type) {
			throw new ORPCError("BAD_REQUEST", {
				message: "This file is not a real JPG, PNG or MP4. Upload the original file.",
			})
		}

		const spec = ANNOUNCEMENT_MEDIA_TYPES[contentType]
		const mediaKey = `announcements/${randomUUID()}.${spec.extension}`
		await this.storage.put(mediaKey, bytes, contentType)
		await this.auditService.record({
			domain: AUDIT_DOMAIN_SETTINGS,
			action: "announcement.media_upload",
			actorId: actor,
			targetType: "file",
			targetId: mediaKey,
			oldValue: null,
			newValue: { contentType, sizeBytes: bytes.length },
		})
		return { mediaKey, mediaType: spec.mediaType, contentType, sizeBytes: bytes.length }
	}

	async create(
		input: CreateAnnouncementInput,
		actorId: string | null,
		now: Date = new Date()
	): Promise<Announcement> {
		const actor = requireActor(actorId)
		const mediaType = await this.checkMedia(input.mediaKey)

		const created = await db.transaction(async tx => {
			const [row] = await tx
				.insert(announcements)
				.values({
					title: input.title,
					mediaUrl: input.mediaKey,
					mediaType,
					startsAt: new Date(input.startsAt),
					endsAt: input.endsAt ? new Date(input.endsAt) : null,
					isActive: false,
					createdBy: actor,
					// Set here, not by the database default (local DBs are UTC+8).
					createdAt: now,
					updatedAt: now,
				})
				.returning()
			if (!row) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "The announcement could not be saved",
				})
			}
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_SETTINGS,
					action: "announcement.create",
					actorId: actor,
					targetType: "announcement",
					targetId: String(row.id),
					oldValue: null,
					newValue: auditView(row),
				},
				tx
			)
			return row
		})

		return this.readBack(created.id, now)
	}

	async update(
		input: UpdateAnnouncementInput,
		actorId: string | null,
		now: Date = new Date()
	): Promise<Announcement> {
		const actor = requireActor(actorId)

		await db.transaction(async tx => {
			const [current] = await tx
				.select()
				.from(announcements)
				.where(eq(announcements.id, input.id))
				.for("update")
			if (!current) throw notFound()

			const mediaType =
				input.mediaKey === current.mediaUrl
					? current.mediaType
					: await this.checkMedia(input.mediaKey)

			const [updated] = await tx
				.update(announcements)
				.set({
					title: input.title,
					mediaUrl: input.mediaKey,
					mediaType,
					startsAt: new Date(input.startsAt),
					endsAt: input.endsAt ? new Date(input.endsAt) : null,
					updatedAt: now,
				})
				.where(eq(announcements.id, input.id))
				.returning()
			if (!updated) throw notFound()

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_SETTINGS,
					action: "announcement.update",
					actorId: actor,
					targetType: "announcement",
					targetId: String(current.id),
					oldValue: auditView(current),
					newValue: auditView(updated),
				},
				tx
			)
		})

		return this.readBack(input.id, now)
	}

	/** Switching to the state it already has changes nothing and is not audited. */
	async setActive(
		id: number,
		isActive: boolean,
		actorId: string | null,
		now: Date = new Date()
	): Promise<Announcement> {
		const actor = requireActor(actorId)

		await db.transaction(async tx => {
			const [current] = await tx
				.select()
				.from(announcements)
				.where(eq(announcements.id, id))
				.for("update")
			if (!current) throw notFound()
			if (current.isActive === isActive) return

			await tx
				.update(announcements)
				.set({ isActive, updatedAt: now })
				.where(eq(announcements.id, id))
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_SETTINGS,
					action: isActive ? "announcement.activate" : "announcement.deactivate",
					actorId: actor,
					targetType: "announcement",
					targetId: String(id),
					oldValue: { isActive: current.isActive },
					newValue: { isActive },
				},
				tx
			)
		})

		return this.readBack(id, now)
	}

	/**
	 * The stored file. `preview` (admins) returns it in any state; otherwise
	 * only while the Announcement is showing. Null when there is nothing to send.
	 */
	async media(
		id: number,
		preview: boolean,
		now: Date = new Date()
	): Promise<{ body: Uint8Array; contentType: AnnouncementContentType } | null> {
		const [row] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1)
		if (!row) return null
		if (!preview && announcementState(row, now) !== "showing") return null
		const body = await this.storage.read(row.mediaUrl)
		if (!body) return null
		return { body, contentType: contentTypeOfKey(row.mediaUrl) }
	}

	/** A key from our own upload route that is still stored; returns image or video. */
	private async checkMedia(mediaKey: string): Promise<AnnouncementMediaKind> {
		if (!ANNOUNCEMENT_MEDIA_KEY_PATTERN.test(mediaKey) || !(await this.storage.exists(mediaKey))) {
			throw new ORPCError("BAD_REQUEST", { message: "Upload the image or video again" })
		}
		return ANNOUNCEMENT_MEDIA_TYPES[contentTypeOfKey(mediaKey)].mediaType
	}

	private async readBack(id: number, now: Date): Promise<Announcement> {
		const [found] = await db
			.select({ row: announcements, createdByEmail: users.email })
			.from(announcements)
			.leftJoin(users, eq(announcements.createdBy, users.id))
			.where(eq(announcements.id, id))
			.limit(1)
		if (!found) throw notFound()
		return toAnnouncement(found.row, found.createdByEmail ?? null, now)
	}
}
