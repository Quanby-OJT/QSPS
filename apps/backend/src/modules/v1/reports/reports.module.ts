import { Module } from "@nestjs/common"

import { ExportModule } from "@/common/export/export.module"
import { ScopeModule } from "@/common/scope/scope.module"

import { ReportsController } from "./reports.controller"
import { ReportsService } from "./reports.service"

@Module({
	imports: [ScopeModule, ExportModule],
	controllers: [ReportsController],
	providers: [ReportsService],
})
export class ReportsModule {}