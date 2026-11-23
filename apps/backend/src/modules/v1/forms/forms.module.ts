import { Module } from "@nestjs/common"

import { ScopeModule } from "@/common/scope/scope.module"

import { FormsController } from "./forms.controller"
import { FormsService } from "./forms.service"

/** FRM-1: Form Templates (the questionnaire a client answers for a Service). */
@Module({
	imports: [ScopeModule],
	controllers: [FormsController],
	providers: [FormsService],
	// FRM-2 reads published templates and writes submissions through this service.
	exports: [FormsService],
})
export class FormsModule {}
