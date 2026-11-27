import { Global, Module } from "@nestjs/common"

import { StorageModule } from "@/common/storage/storage.module"

import { AuditArchiveService } from "./audit-archive.service"

/** OPS-4: archived audit entries stay searchable. Global so the audit log route can read them. */
@Global()
@Module({
	imports: [StorageModule],
	providers: [AuditArchiveService],
	exports: [AuditArchiveService],
})
export class ArchiveModule {}
