import { Module } from "@nestjs/common"

import { ExportModule } from "@/common/export/export.module"
import { RbacModule } from "@/common/rbac/rbac.module"

import { RbacAdminService } from "./rbac-admin.service"
import { RbacController } from "./rbac.controller"

@Module({
	imports: [RbacModule, ExportModule],
	controllers: [RbacController],
	providers: [RbacAdminService],
})
export class RbacAdminModule {}
