import { Module } from "@nestjs/common"

import { ScopeModule } from "@/common/scope/scope.module"

import { ReportsController } from "./reports.controller"
import { ReportsService } from "./reports.service"

@Module({
	imports: [ScopeModule],
	controllers: [ReportsController],
	providers: [ReportsService],
})
export class ReportsModule {}