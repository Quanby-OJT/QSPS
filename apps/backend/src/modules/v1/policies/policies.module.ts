import { Module } from "@nestjs/common"

import { PoliciesController } from "./policies.controller"

/** ADM-6. `PolicyService` comes from the global `PolicyModule`. */
@Module({
	controllers: [PoliciesController],
})
export class PoliciesModule {}
