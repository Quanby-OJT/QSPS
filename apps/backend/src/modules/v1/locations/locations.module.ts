import { Module } from "@nestjs/common"

import { ScopeModule } from "@/common/scope/scope.module"

import { LocationsController } from "./locations.controller"
import { LocationsService } from "./locations.service"

@Module({
	imports: [ScopeModule],
	controllers: [LocationsController],
	providers: [LocationsService],
})
export class LocationsModule {}
