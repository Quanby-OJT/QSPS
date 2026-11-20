import { inflateRawSync } from "node:zlib"

import { ExportService } from "./export.service"

describe("ExportService", () => {
	const service = new ExportService()
	const columns = [
		{ key: "name" as const, header: "Name" },
		{ key: "email" as const, header: "Email" },
		{ key: "roles" as const, header: "Roles" },
	]
	const rows = [
		{ name: "Maria Santos", email: "maria@boq.gov.ph", roles: ["System Admin", "Auditor"] },
		{ name: 'Juan "Jr" Cruz', email: "juan@boq.gov.ph", roles: ["Processing Officer"] },
	]

	it("exports RFC-escaped CSV with UTF-8 BOM", async () => {
		const result = await service.exportTable({
			format: "csv",
			fileBaseName: "users-export",
			title: "QSPS Users",
			columns,
			rows,
		})

		expect(result.fileName).toBe("users-export.csv")
		expect(result.mimeType).toContain("text/csv")
		const text = result.buffer.toString("utf8")
		expect(text).toContain("Name,Email,Roles")
		expect(text).toContain('"System Admin, Auditor"')
		expect(text).toContain('"Juan ""Jr"" Cruz"')
	})

	it("exports a valid OOXML XLSX archive containing worksheet cells", async () => {
		const result = await service.exportTable({
			format: "xlsx",
			fileBaseName: "users-export",
			title: "QSPS Users",
			columns,
			rows,
		})

		expect(result.fileName).toBe("users-export.xlsx")
		expect(result.mimeType).toBe(
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
		)
		// ZIP magic header PK\x03\x04
		expect(result.buffer.subarray(0, 4).toString("binary")).toBe("PK\x03\x04")

		// Locate and inflate xl/worksheets/sheet1.xml to verify cell content
		const sheetEntryIdx = result.buffer.indexOf(Buffer.from("xl/worksheets/sheet1.xml"))
		expect(sheetEntryIdx).toBeGreaterThan(0)
		const compressedSize = result.buffer.readUInt32LE(sheetEntryIdx - 12)
		const dataStart = sheetEntryIdx + "xl/worksheets/sheet1.xml".length
		const xml = inflateRawSync(result.buffer.subarray(dataStart, dataStart + compressedSize)).toString(
			"utf8"
		)
		expect(xml).toContain("maria@boq.gov.ph")
		expect(xml).toContain("System Admin, Auditor")
	})

	it("exports a valid PDF document buffer", async () => {
		const result = await service.exportTable({
			format: "pdf",
			fileBaseName: "users-export",
			title: "QSPS Users",
			columns,
			rows,
		})

		expect(result.fileName).toBe("users-export.pdf")
		expect(result.mimeType).toBe("application/pdf")
		expect(result.buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-")
		expect(result.buffer.length).toBeGreaterThan(500)
	})
})