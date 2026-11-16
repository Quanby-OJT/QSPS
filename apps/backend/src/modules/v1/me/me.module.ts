import { Module } from "@nestjs/common"

import { RbacModule } from "@/common/rbac/rbac.module"

import { MeController } from "./me.controller"

import { MeProfileService } from "./me-profile.service"

@Module({
	imports: [RbacModule],
	controllers: [MeController],
	providers: [MeProfileService],
})
export class MeModule {}
