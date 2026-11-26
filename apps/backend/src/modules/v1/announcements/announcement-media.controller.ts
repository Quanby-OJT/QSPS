import {
	Controller,
	Get,
	Headers,
	NotFoundException,
	Param,
	ParseIntPipe,
	Res,
} from "@nestjs/common"
import { AllowAnonymous } from "@thallesp/nestjs-better-auth"
import type { Response } from "express"

import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"

import { parseByteRange } from "./announcement-rules"
import { ANNOUNCEMENTS_MANAGE } from "./announcements.controller"
import { AnnouncementService } from "./announcements.service"

type MediaFile = NonNullable<Awaited<ReturnType<AnnouncementService["media"]>>>

/** Sends the file, or the byte range asked for (Safari needs ranges to play video). */
function sendMedia(
	response: Response,
	file: MediaFile,
	rangeHeader: string | undefined,
	cacheControl: string
): void {
	const size = file.body.length
	response.setHeader("Cache-Control", cacheControl)
	response.setHeader("Content-Type", file.contentType)
	response.setHeader("Accept-Ranges", "bytes")
	response.setHeader("X-Content-Type-Options", "nosniff")
	// The web app runs on another origin and shows this in <img> or <video>.
	response.setHeader("Cross-Origin-Resource-Policy", "cross-origin")

	const range = parseByteRange(rangeHeader, size)
	if (range === "invalid") {
		response.status(416)
		response.setHeader("Content-Range", `bytes */${size}`)
		response.end()
		return
	}
	if (range) {
		response.status(206)
		response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`)
		response.setHeader("Content-Length", String(range.end - range.start + 1))
		response.end(Buffer.from(file.body.subarray(range.start, range.end + 1)))
		return
	}
	response.setHeader("Content-Length", String(size))
	response.end(Buffer.from(file.body))
}

/**
 * AUTH-4: the Announcement's image or video. Plain routes rather than oRPC
 * because they answer with the file's bytes. Storage stays private; the API
 * decides who may see each file.
 */
@Controller("v1/announcements")
export class AnnouncementMediaController {
	constructor(private readonly announcementService: AnnouncementService) {}

	/** GET /api/v1/announcements/{id}/media: public, only while the Announcement is showing. */
	@AllowAnonymous()
	@Get(":id/media")
	async media(
		@Param("id", ParseIntPipe) id: number,
		@Res() response: Response,
		@Headers("range") range?: string
	): Promise<void> {
		const file = await this.announcementService.media(id, false)
		if (!file) throw new NotFoundException("There is no announcement to show")
		sendMedia(response, file, range, "public, max-age=300")
	}

	/** GET /api/v1/announcements/{id}/media/preview: admins, in any state. */
	@RequirePermissions(ANNOUNCEMENTS_MANAGE)
	@Get(":id/media/preview")
	async preview(
		@Param("id", ParseIntPipe) id: number,
		@Res() response: Response,
		@Headers("range") range?: string
	): Promise<void> {
		const file = await this.announcementService.media(id, true)
		if (!file) throw new NotFoundException("This announcement was not found")
		sendMedia(response, file, range, "private, no-store")
	}
}
