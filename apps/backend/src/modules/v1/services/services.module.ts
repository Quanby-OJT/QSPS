import { Module } from "@nestjs/common"

import { ScopeModule } from "@/common/scope/scope.module"

import { ServicesController } from "./services.controller"
import { ServicesService } from "./services.service"

@Module({
	imports: [ScopeModule],
	controllers: [ServicesController],
	providers: [ServicesService],
})
export class ServicesModule {}
