import { Module } from "@nestjs/common"

import { StorageModule } from "@/common/storage/storage.module"

import { AnnouncementMediaController } from "./announcement-media.controller"
import { AnnouncementsController } from "./announcements.controller"
import { AnnouncementService } from "./announcements.service"

/** AUTH-4: the Gender and Development flash screen. `AuditService` is global. */
@Module({
	imports: [StorageModule],
	controllers: [AnnouncementsController, AnnouncementMediaController],
	providers: [AnnouncementService],
})
export class AnnouncementsModule {}
