import { Inject, Injectable, Logger } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"

import { FILE_STORAGE, type FileStorage } from "@/common/storage/file-storage"

import { PENDING_UPLOAD_MAX_AGE_MS, PENDING_UPLOAD_PREFIX } from "./pending-uploads"

/**
 * FRM-2b: deletes file answers that were uploaded but never saved with a
 * booking. Runs daily at 03:00 Manila time and removes pending uploads older
 * than 24 hours. Files in the confirmed folders are never touched. Running it
 * twice (two instances) is harmless: a delete of a gone file is not an error.
 */
@Injectable()
export class PendingUploadsCleanupService {
	private readonly logger = new Logger(PendingUploadsCleanupService.name)

	constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

	@Cron("0 3 * * *", { name: "pending-uploads-cleanup", timeZone: "Asia/Manila" })
	async run(): Promise<void> {
		try {
			await this.sweep()
		} catch (error) {
			this.logger.error({
				event: "forms.pending_uploads.sweep_failed",
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	/** Delete pending uploads older than 24 hours. Returns how many were deleted. */
	async sweep(now: Date = new Date()): Promise<number> {
		const cutoff = now.getTime() - PENDING_UPLOAD_MAX_AGE_MS
		const files = await this.storage.list(PENDING_UPLOAD_PREFIX)
		let deleted = 0
		for (const file of files) {
			if (file.lastModified.getTime() >= cutoff) continue
			try {
				await this.storage.delete(file.key)
				deleted += 1
			} catch (error) {
				// One stuck file must not stop the rest; it is retried tomorrow.
				this.logger.warn({
					event: "forms.pending_uploads.delete_failed",
					key: file.key,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}
		this.logger.log({ event: "forms.pending_uploads.swept", scanned: files.length, deleted })
		return deleted
	}
}
