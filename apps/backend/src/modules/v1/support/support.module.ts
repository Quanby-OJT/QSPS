import { Module } from "@nestjs/common"

import { SupportController } from "./support.controller"

/** ADM-8. `PolicyService` comes from the global `PolicyModule`. */
@Module({
	controllers: [SupportController],
})
export class SupportModule {}
