import {
	CopyObjectCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3"

import {
	assertStorageKey,
	assertStoragePrefix,
	type FileStorage,
	type StoredFile,
} from "./file-storage"

export interface S3StorageOptions {
	bucket: string
	region: string
	/** Only for S3-compatible services other than AWS (Supabase Storage, MinIO). */
	endpoint?: string
	accessKeyId?: string
	secretAccessKey?: string
	forcePathStyle: boolean
}

/** What this adapter needs from the SDK client, so tests can pass a fake. */
export type S3Sender = Pick<S3Client, "send">

function isMissing(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false
	const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } }
	return name === "NotFound" || name === "NoSuchKey" || $metadata?.httpStatusCode === 404
}

export function createS3Client(options: S3StorageOptions): S3Client {
	return new S3Client({
		region: options.region,
		endpoint: options.endpoint,
		forcePathStyle: options.forcePathStyle,
		credentials:
			options.accessKeyId && options.secretAccessKey
				? { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
				: undefined,
	})
}

/**
 * `FileStorage` on an S3-compatible bucket. The bucket must be private: no
 * object is written with a public ACL, and files are read back only through
 * the API.
 */
export class S3FileStorage implements FileStorage {
	constructor(
		private readonly bucket: string,
		private readonly client: S3Sender
	) {}

	async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
		assertStorageKey(key)
		await this.client.send(
			new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType })
		)
	}

	async exists(key: string): Promise<boolean> {
		assertStorageKey(key)
		try {
			await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
			return true
		} catch (error) {
			if (isMissing(error)) return false
			throw error
		}
	}

	async read(key: string): Promise<Uint8Array | null> {
		assertStorageKey(key)
		try {
			const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
			return object.Body ? await object.Body.transformToByteArray() : null
		} catch (error) {
			if (isMissing(error)) return null
			throw error
		}
	}

	async copy(from: string, to: string): Promise<void> {
		assertStorageKey(from)
		assertStorageKey(to)
		// Keys only ever hold [A-Za-z0-9._-/], so the source needs no URL encoding.
		await this.client.send(
			new CopyObjectCommand({ Bucket: this.bucket, Key: to, CopySource: `${this.bucket}/${from}` })
		)
	}

	async delete(key: string): Promise<void> {
		assertStorageKey(key)
		// S3 answers success for a key that is already gone.
		await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
	}

	async list(prefix: string): Promise<StoredFile[]> {
		assertStoragePrefix(prefix)
		const files: StoredFile[] = []
		let token: string | undefined
		do {
			const page = await this.client.send(
				new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token })
			)
			for (const object of page.Contents ?? []) {
				if (object.Key && object.LastModified) {
					files.push({ key: object.Key, lastModified: object.LastModified })
				}
			}
			token = page.IsTruncated ? page.NextContinuationToken : undefined
		} while (token)
		return files
	}
}
