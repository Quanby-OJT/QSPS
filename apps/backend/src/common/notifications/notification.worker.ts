import { Injectable, Logger } from "@nestjs/common"
import { Cron, CronExpression } from "@nestjs/schedule"
import { and, asc, eq, lte } from "drizzle-orm"

import type { MailMessage } from "@repo/auth"
import { notifications, users } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { PdfService } from "@/common/pdf/pdf.service"
import { ReceiptService } from "@/modules/v1/payments/receipts.service"

import { TemplateEmailSender } from "./email.sender"
import { renderNotification } from "./notification-templates"

const MAX_ATTEMPTS = 5
const BATCH_SIZE = 20

export function nextAttempt(now: Date, attempts: number): Date {
	return new Date(now.getTime() + Math.min(60, 2 ** (attempts - 1)) * 60_000)
}

@Injectable()
export class NotificationWorker {
	private readonly logger = new Logger(NotificationWorker.name)
	private running = false

	constructor(
		private readonly sender: TemplateEmailSender,
		private readonly receipts: ReceiptService,
		private readonly pdf: PdfService
	) {}

	@Cron(CronExpression.EVERY_MINUTE)
	async run(): Promise<void> {
		if (this.running) return

		this.running = true

		try {
			for (let i = 0; i < BATCH_SIZE; i++) {
				if (!(await this.processOne())) break
			}
		} finally {
			this.running = false
		}
	}

	async processOne(now = new Date()): Promise<boolean> {
		return db.transaction(async tx => {
			const [row] = await tx
				.select()
				.from(notifications)
				.where(
					and(
						eq(notifications.channel, "email"),
						eq(notifications.status, "queued"),
						lte(notifications.nextAttemptAt, now)
					)
				)
				.orderBy(asc(notifications.nextAttemptAt), asc(notifications.id))
				.limit(1)
				.for("update", { skipLocked: true })

			if (!row) return false

			const attempts = row.attempts + 1

			try {
				const [user] = await tx
					.select({ email: users.email })
					.from(users)
					.where(eq(users.id, row.userId))

				if (!user) {
					throw new Error("Notification recipient not found")
				}

				const referenceNumber = row.payload.referenceNumber

				if (typeof referenceNumber !== "string") {
					throw new Error("Missing booking reference")
				}

				const message: MailMessage = {
					to: user.email,
					...renderNotification(row.template, referenceNumber),
				}

				if (row.template === "payment_received") {
					const paymentId = row.payload.paymentId

					if (typeof paymentId !== "number") {
						throw new Error("Missing payment ID")
					}

					const receipt = await this.receipts.renderForOwner(paymentId, row.userId)

					const qr = await this.pdf.qrPng(referenceNumber)

					message.attachments = [
						{
							filename: receipt.fileName,
							content: receipt.pdf,
							contentType: "application/pdf",
						},
						{
							filename: "booking-qr.png",
							content: qr,
							contentType: "image/png",
						},
					]
				}

				await this.sender.send(message)
			} catch {
				await tx
					.update(notifications)
					.set({
						attempts,
						status: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
						nextAttemptAt: nextAttempt(now, attempts),
					})
					.where(eq(notifications.id, row.id))

				this.logger.warn(`Notification ${row.id} delivery attempt ${attempts} failed`)

				return true
			}

			await tx
				.update(notifications)
				.set({
					status: "sent",
					attempts,
				})
				.where(eq(notifications.id, row.id))

			return true
		})
	}
}
