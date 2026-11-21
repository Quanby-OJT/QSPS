import { Module } from "@nestjs/common"

import { ScopeModule } from "@/common/scope/scope.module"

import { SchedulesController } from "./schedules.controller"
import { SchedulesService } from "./schedules.service"

@Module({
	imports: [ScopeModule],
	controllers: [SchedulesController],
	providers: [SchedulesService],
})
export class SchedulesModule {}
