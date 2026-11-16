import { Module } from "@nestjs/common"

import { RbacModule } from "@/common/rbac/rbac.module"

import { MeProfileService } from "./me-profile.service"
import { MeController } from "./me.controller"

@Module({
	imports: [RbacModule],
	controllers: [MeController],
	providers: [MeProfileService],
})
export class MeModule {}
