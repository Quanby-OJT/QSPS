import { Logger, Module } from "@nestjs/common"

import { env, type Env } from "@/config/env.config"

import { FILE_STORAGE, type FileStorage } from "./file-storage"
import { LocalFileStorage } from "./local-file-storage"
import { createS3Client, S3FileStorage } from "./s3-file-storage"

type StorageConfig = Pick<
	Env,
	| "NODE_ENV"
	| "STORAGE_DRIVER"
	| "STORAGE_LOCAL_DIR"
	| "S3_BUCKET"
	| "S3_REGION"
	| "S3_ENDPOINT"
	| "S3_ACCESS_KEY_ID"
	| "S3_SECRET_ACCESS_KEY"
	| "S3_FORCE_PATH_STYLE"
>

/** The storage the environment asks for. S3 without a bucket refuses to boot. */
export function createFileStorage(config: StorageConfig = env): FileStorage {
	if (config.STORAGE_DRIVER === "s3") {
		if (!config.S3_BUCKET || !config.S3_REGION) {
			throw new Error("STORAGE_DRIVER=s3 needs S3_BUCKET and S3_REGION")
		}
		const client = createS3Client({
			bucket: config.S3_BUCKET,
			region: config.S3_REGION,
			endpoint: config.S3_ENDPOINT,
			accessKeyId: config.S3_ACCESS_KEY_ID,
			secretAccessKey: config.S3_SECRET_ACCESS_KEY,
			forcePathStyle: config.S3_FORCE_PATH_STYLE,
		})
		return new S3FileStorage(config.S3_BUCKET, client)
	}
	if (config.NODE_ENV === "production") {
		new Logger("StorageModule").warn(
			"STORAGE_DRIVER is local: uploads are kept on this server's disk only. Use s3 in production."
		)
	}
	return new LocalFileStorage(config.STORAGE_LOCAL_DIR)
}

/** FRM-2: the `FileStorage` for private uploads, chosen by STORAGE_DRIVER. */
@Module({
	providers: [{ provide: FILE_STORAGE, useFactory: () => createFileStorage() }],
	exports: [FILE_STORAGE],
})
export class StorageModule {}
