import { Module } from "@nestjs/common"

import { RbacModule } from "@/common/rbac/rbac.module"

import { RbacAdminService } from "./rbac-admin.service"
import { RbacController } from "./rbac.controller"
import { ExportModule } from "@/common/export/export.module"

@Module({
	imports: [RbacModule, ExportModule],
	controllers: [RbacController],
	providers: [RbacAdminService],
})
export class RbacAdminModule {}
