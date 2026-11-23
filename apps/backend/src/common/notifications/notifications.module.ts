import { Module } from "@nestjs/common"

import { PdfModule } from "@/common/pdf/pdf.module"
import { PaymentsModule } from "@/modules/v1/payments/payments.module"

import { EMAIL_SENDER } from "./email-sender.token"
import { TemplateEmailSender } from "./email.sender"
import { NotificationWorker } from "./notification.worker"

@Module({
	imports: [PaymentsModule, PdfModule],
	providers: [{ provide: EMAIL_SENDER, useClass: TemplateEmailSender }, NotificationWorker],
})
export class NotificationsModule {}
