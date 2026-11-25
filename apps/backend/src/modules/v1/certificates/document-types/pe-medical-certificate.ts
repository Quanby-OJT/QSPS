import type { DocumentTypeDefinition } from "./document-type"

export const peMedicalCertificate: DocumentTypeDefinition<undefined> = {
	type: "pe-medical-certificate",
	title: "Physical Examination Medical Certificate",
	numberPrefix: "PEM",
	validUntil: () => null,

	buildPayload(context) {
		return {
			holder: { name: context.holder.name },
			issuingLocation: context.locationName,
		}
	},

	draw(doc, payload, extras) {
		const holder = payload.holder as { name?: string } | undefined
		doc.font("Helvetica-Bold").fontSize(18).text("Physical Examination Medical Certificate")
		doc.moveDown().font("Helvetica").fontSize(11)
		doc.text(`Document Number: ${extras.documentNumber}`)
		doc.text(`Examinee: ${holder?.name ?? ""}`)
		doc.text(`Issuing Location: ${String(payload.issuingLocation ?? "")}`)
		doc.text(`Document status: ${extras.status.toUpperCase()}`)
		doc.moveDown()
		doc.text("The examinee was evaluated and found fit.")
		doc.moveDown()
		const qrY = doc.y
		doc.image(extras.qrPng, doc.page.margins.left, qrY, { width: 80 })
		doc.y = qrY + 88
		doc.fontSize(9).text(extras.verifyUrl)
	},
}
