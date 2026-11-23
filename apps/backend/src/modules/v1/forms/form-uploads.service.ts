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

import type { FormExecutor } from "./form-submissions.token"
import {
	confirmedKeyOf,
	isPendingUploadKey,
	PENDING_UPLOAD_PREFIX,
	uploadOwnerOf,
} from "./pending-uploads"

/** A user id that can name a storage folder (Better Auth ids always can). */
const USER_FOLDER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** The name shown back to the client: no folders, at most 200 characters. */
function displayName(name: string): string {
	const base = name.split(/[\\/]/).pop()?.trim() ?? ""
	return (base || "upload").slice(0, 200)
}

/**
 * File answers to questionnaires (FRM-2). A client uploads the file before
 * confirming the booking; the answer then holds the returned key.
 *
 * FRM-2b: a new upload goes to `form-uploads/pending/<userId>/`. When the
 * answers that use it are saved, `confirmUpload` copies it to
 * `form-uploads/<userId>/`, and the stored answer holds that key. Pending
 * files nobody saved are deleted by `PendingUploadsCleanupService`.
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

		const fileKey = `${PENDING_UPLOAD_PREFIX}${actorId}/${randomUUID()}.${FORM_UPLOAD_TYPES[contentType]}`
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

	/**
	 * Whether `fileKey` is one of the caller's own uploads and is stored:
	 * a pending one, or one already confirmed by earlier saved answers.
	 */
	async ownsUpload(fileKey: string, actorId: string): Promise<boolean> {
		if (!FORM_UPLOAD_KEY_PATTERN.test(fileKey)) return false
		if (uploadOwnerOf(fileKey) !== actorId) return false
		return this.storage.exists(fileKey)
	}

	/**
	 * The key a saved answer should hold. A pending upload is copied to the
	 * caller's confirmed folder (once; a second save reuses the copy); a key
	 * that is already confirmed is returned as it is. Call `ownsUpload` first.
	 */
	/** `executor`: the booking transaction, so the audit line commits or rolls back with it. */
	async confirmUpload(fileKey: string, actorId: string, executor: FormExecutor): Promise<string> {
		if (!isPendingUploadKey(fileKey)) return fileKey
		const confirmed = confirmedKeyOf(fileKey)
		if (!(await this.storage.exists(confirmed))) {
			await this.storage.copy(fileKey, confirmed)
			await this.auditService.record(
				{
					domain: "forms",
					action: "form_upload.confirm",
					actorId,
					targetType: "file",
					targetId: confirmed,
					oldValue: { fileKey },
					newValue: { fileKey: confirmed },
				},
				executor
			)
		}
		return confirmed
	}
}
