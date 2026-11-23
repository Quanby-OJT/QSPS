import { Inject, Injectable } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { ORPCError } from "@orpc/server"

import {
	FORM_UPLOAD_KEY_PATTERN,
	FORM_UPLOAD_MAX_BYTES,
	FORM_UPLOAD_TYPES,
	type FormUpload,
} from "@repo/contracts"

import { AuditService } from "@/common/audit/audit.service"
import { sniffContentType } from "@/common/storage/content-type"
import { FILE_STORAGE, type FileStorage } from "@/common/storage/file-storage"

/** A user id that can name a storage folder (Better Auth ids always can). */
const USER_FOLDER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** The name shown back to the client: no folders, at most 200 characters. */
function displayName(name: string): string {
	const base = name.split(/[\\/]/).pop()?.trim() ?? ""
	return (base || "upload").slice(0, 200)
}

/**
 * File answers to questionnaires (FRM-2). A client uploads the file before
 * confirming the booking; the answer then holds the returned key. Each
 * client's files live in their own folder, and the booking only accepts a
 * key from the caller's own folder that is really stored.
 */
@Injectable()
export class FormUploadService {
	constructor(
		@Inject(FILE_STORAGE) private readonly storage: FileStorage,
		private readonly auditService: AuditService
	) {}

	async upload(file: File, actorId: string | null): Promise<FormUpload> {
		if (!actorId) {
			throw new ORPCError("UNAUTHORIZED", { message: "Sign in to upload a file" })
		}
		if (!USER_FOLDER_PATTERN.test(actorId)) {
			throw new ORPCError("BAD_REQUEST", { message: "Files cannot be uploaded for this account" })
		}
		if (file.size === 0) {
			throw new ORPCError("BAD_REQUEST", { message: "The file is empty" })
		}
		if (file.size > FORM_UPLOAD_MAX_BYTES) {
			throw new ORPCError("BAD_REQUEST", { message: "Files can be at most 5 MB" })
		}

		const bytes = new Uint8Array(await file.arrayBuffer())
		const contentType = sniffContentType(bytes)
		// The browser's declared type is a claim; the bytes must agree with it.
		if (!contentType || contentType !== file.type) {
			throw new ORPCError("BAD_REQUEST", {
				message: "This file is not a real PDF, JPG or PNG. Upload the original file.",
			})
		}

		const fileKey = `form-uploads/${actorId}/${randomUUID()}.${FORM_UPLOAD_TYPES[contentType]}`
		await this.storage.put(fileKey, bytes, contentType)
		await this.auditService.record({
			domain: "forms",
			action: "form_upload.create",
			actorId,
			targetType: "file",
			targetId: fileKey,
			oldValue: null,
			newValue: { contentType, sizeBytes: bytes.length },
		})
		return {
			fileKey,
			fileName: displayName(file.name),
			contentType,
			sizeBytes: bytes.length,
		}
	}

	/** Whether `fileKey` is one of the caller's own uploads and is stored. */
	async ownsUpload(fileKey: string, actorId: string): Promise<boolean> {
		if (!FORM_UPLOAD_KEY_PATTERN.test(fileKey)) return false
		if (!fileKey.startsWith(`form-uploads/${actorId}/`)) return false
		return this.storage.exists(fileKey)
	}
}
