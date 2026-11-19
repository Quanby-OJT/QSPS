import { oc } from "@orpc/contract"
import { z } from "zod"

import {
	DocumentSummarySchema,
	DocumentTokenParamSchema,
	DocumentVerificationSchema,
	IssueDocumentSchema,
	ManualVerificationSchema,
	MyDocumentsSchema,
} from "./certificates.schema.js"

/**
 * Documents (CRT-1, Flow D). The PDF itself is a plain route,
 * GET /api/v1/certificates/documents/{documentId}/pdf, because it answers
 * with PDF bytes. The two verify routes are public (CRT-2).
 */
export const certificatesContract = {
	issue: oc
		.route({
			method: "POST",
			path: "/certificates/items/{bookingItemId}/documents",
			summary: "Issue the document for a cleared Booking Item",
			description:
				"For Services with auto-issue off. Creates one Document with the next number for its type and Location, moves the item to issued and completes the Booking when every item is final. Issuing twice returns the same Document. Needs certificates.documents:issue; an item at another Location answers 404.",
			tags: ["Certificates"],
		})
		.input(IssueDocumentSchema)
		.output(DocumentSummarySchema),
	mine: oc
		.route({
			method: "GET",
			path: "/certificates/mine",
			summary: "My Documents",
			description: "The signed-in client's documents, newest first. Needs certificates.own:read.",
			tags: ["Certificates"],
		})
		.input(z.object({}).optional())
		.output(MyDocumentsSchema),
	verify: oc
		.route({
			method: "GET",
			path: "/certificates/verify/{token}",
			summary: "Verify a document by its QR code",
			description:
				"Public, no session. Looks up the Document behind a scanned QR code and returns its type, number, masked holder name, issuing Location, issue date and status from the database. An unknown or malformed token answers 404 and nothing else. Rate limited.",
			tags: ["Certificates"],
		})
		.input(DocumentTokenParamSchema)
		.output(DocumentVerificationSchema),
	verifyByNumber: oc
		.route({
			method: "GET",
			path: "/certificates/verify",
			summary: "Verify a document by its number and code",
			description:
				"Public, no session. The same lookup for someone without a scanner: the Document Number plus the code printed under the QR code. A wrong pair answers 404 and nothing else. Rate limited.",
			tags: ["Certificates"],
		})
		.input(ManualVerificationSchema)
		.output(DocumentVerificationSchema),
}
