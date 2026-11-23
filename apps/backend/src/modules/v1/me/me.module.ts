import { Module } from "@nestjs/common"

import { RbacModule } from "@/common/rbac/rbac.module"

import { MeProfileService } from "./me-profile.service"
import { MeSmsController } from "./me-sms.controller"
import { MeSmsService } from "./me-sms.service"
import { MeController } from "./me.controller"

@Module({
	imports: [RbacModule],
	controllers: [MeController, MeSmsController],
	providers: [MeProfileService, MeSmsService],
})
export class MeModule {}
