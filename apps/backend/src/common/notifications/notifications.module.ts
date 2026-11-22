import { Module } from "@nestjs/common"

import { PdfModule } from "@/common/pdf/pdf.module"
import { PaymentsModule } from "@/modules/v1/payments/payments.module"

import { TemplateEmailSender } from "./email.sender"
import { NotificationWorker } from "./notification.worker"

@Module({
	imports: [PaymentsModule, PdfModule],
	providers: [TemplateEmailSender, NotificationWorker],
})
export class NotificationsModule {}
