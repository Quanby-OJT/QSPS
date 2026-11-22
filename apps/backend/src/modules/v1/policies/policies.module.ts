import { Module } from "@nestjs/common"

import { PoliciesController } from "./policies.controller"
import { PolicyDocumentsController } from "./policy-documents.controller"
import { PolicyDocumentService } from "./policy-documents.service"

/**
 * ADM-6 rule values and ADM-9 written policies. `PolicyService` comes from the
 * global `PolicyModule`. `PolicyDocumentService` is exported so the booking
 * API can list the policies that apply to a Service.
 */
@Module({
	controllers: [PoliciesController, PolicyDocumentsController],
	providers: [PolicyDocumentService],
	exports: [PolicyDocumentService],
})
export class PoliciesModule {}
