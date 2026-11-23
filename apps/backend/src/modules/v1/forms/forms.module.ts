import { Module } from "@nestjs/common"

import { ScopeModule } from "@/common/scope/scope.module"
import { StorageModule } from "@/common/storage/storage.module"

import { FormSubmissionService } from "./form-submissions.service"
import { FORM_SUBMISSIONS } from "./form-submissions.token"
import { FormUploadService } from "./form-uploads.service"
import { FormsController } from "./forms.controller"
import { FormsService } from "./forms.service"

/**
 * FRM-1: Form Templates (the questionnaire a client answers for a Service).
 * FRM-2: answers and file answers, checked against the active version.
 */
@Module({
	imports: [ScopeModule, StorageModule],
	controllers: [FormsController],
	providers: [
		FormsService,
		FormUploadService,
		FormSubmissionService,
		{ provide: FORM_SUBMISSIONS, useExisting: FormSubmissionService },
	],
	// FRM-2: the booking module reads questionnaires and checks answers through these.
	exports: [FormsService, FormUploadService, FormSubmissionService, FORM_SUBMISSIONS],
})
export class FormsModule {}
