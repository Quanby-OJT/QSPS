import { deflateRawSync } from "node:zlib"
import { Injectable } from "@nestjs/common"
import PDFDocument from "pdfkit"

export type ExportFormat = "csv" | "xlsx" | "pdf"

export interface ExportColumn<T extends Record<string, unknown>> {
	key: keyof T & string
	header: string
}

export interface ExportResult {
	fileName: string
	mimeType: string
	buffer: Buffer
}

@Injectable()
export class ExportService {
	async exportTable<T extends Record<string, unknown>>(options: {
		format: ExportFormat
		fileBaseName: string
		title: string
		columns: ExportColumn<T>[]
		rows: T[]
	}): Promise<ExportResult> {
		const { format, fileBaseName, title, columns, rows } = options

		if (format === "csv") {
			return {
				fileName: `${fileBaseName}.csv`,
				mimeType: "text/csv; charset=utf-8",
				buffer: this.toCsvBuffer(columns, rows),
			}
		}

		if (format === "xlsx") {
			return {
				fileName: `${fileBaseName}.xlsx`,
				mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				buffer: this.toXlsxBuffer(title, columns, rows),
			}
		}

		return {
			fileName: `${fileBaseName}.pdf`,
			mimeType: "application/pdf",
			buffer: await this.toPdfBuffer(title, columns, rows),
		}
	}

	private toCsvBuffer<T extends Record<string, unknown>>(
		columns: ExportColumn<T>[],
		rows: T[]
	): Buffer {
		const escapeCell = (raw: unknown): string => {
			const text = this.formatCellValue(raw)
			if (/[",\r\n]/.test(text)) {
				return `"${text.replace(/"/g, '""')}"`
			}
			return text
		}

		const lines: string[] = [columns.map(col => escapeCell(col.header)).join(",")]
		for (const row of rows) {
			lines.push(columns.map(col => escapeCell(row[col.key])).join(","))
		}

		return Buffer.from(`\uFEFF${lines.join("\r\n")}`, "utf8")
	}

	private toXlsxBuffer<T extends Record<string, unknown>>(
		sheetTitle: string,
		columns: ExportColumn<T>[],
		rows: T[]
	): Buffer {
		const sanitizedSheetName =
			sheetTitle.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Export"

		const xmlEscape = (value: string): string =>
			value
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;")
				.replace(/'/g, "&apos;")

		const columnLetter = (index: number): string => {
			let n = index + 1
			let result = ""
			while (n > 0) {
				const rem = (n - 1) % 26
				result = String.fromCharCode(65 + rem) + result
				n = Math.floor((n - 1) / 26)
			}
			return result
		}

		const allRows: string[][] = [
			columns.map(c => c.header),
			...rows.map(row => columns.map(c => this.formatCellValue(row[c.key]))),
		]

		const sheetRowsXml = allRows
			.map((cells, rowIdx) => {
				const rowNum = rowIdx + 1
				const cellsXml = cells
					.map((text, colIdx) => {
						const ref = `${columnLetter(colIdx)}${rowNum}`
						return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>`
					})
					.join("")
				return `<row r="${rowNum}">${cellsXml}</row>`
			})
			.join("")

		const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`

		const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

		const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${xmlEscape(sanitizedSheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`

		const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`

		const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRowsXml}</sheetData>
</worksheet>`

		return this.buildZip([
			{ name: "[Content_Types].xml", data: Buffer.from(contentTypesXml, "utf8") },
			{ name: "_rels/.rels", data: Buffer.from(rootRelsXml, "utf8") },
			{ name: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
			{ name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRelsXml, "utf8") },
			{ name: "xl/worksheets/sheet1.xml", data: Buffer.from(worksheetXml, "utf8") },
		])
	}

	private async toPdfBuffer<T extends Record<string, unknown>>(
		title: string,
		columns: ExportColumn<T>[],
		rows: T[]
	): Promise<Buffer> {
		return new Promise<Buffer>((resolve, reject) => {
			const doc = new PDFDocument({
				size: "A4",
				layout: "landscape",
				margin: 36,
			})
			const chunks: Buffer[] = []
			doc.on("data", (chunk: Buffer) => chunks.push(chunk))
			doc.on("end", () => resolve(Buffer.concat(chunks)))
			doc.on("error", reject)

			doc.fontSize(15).font("Helvetica-Bold").text(title)
			doc
				.fontSize(9)
				.font("Helvetica")
				.fillColor("#555555")
				.text(`Generated: ${new Date().toISOString()} • Total records: ${rows.length}`)
			doc.moveDown(0.75)

			const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
			const colWidth = columns.length > 0 ? pageWidth / columns.length : pageWidth
			const rowPadding = 4

			const drawRow = (values: string[], isHeader: boolean) => {
				doc.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor("#111111")
				const heights = values.map(val =>
					doc.heightOfString(val, { width: Math.max(20, colWidth - rowPadding * 2) })
				)
				const rowHeight = Math.max(18, ...heights) + rowPadding * 2

				if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
					doc.addPage()
				}

				const startY = doc.y
				if (isHeader) {
					doc
						.save()
						.rect(doc.page.margins.left, startY, pageWidth, rowHeight)
						.fill("#f1f5f9")
						.restore()
				}

				values.forEach((val, idx) => {
					const x = doc.page.margins.left + idx * colWidth + rowPadding
					doc.text(val, x, startY + rowPadding, {
						width: Math.max(20, colWidth - rowPadding * 2),
						align: "left",
					})
				})

				doc
					.moveTo(doc.page.margins.left, startY + rowHeight)
					.lineTo(doc.page.margins.left + pageWidth, startY + rowHeight)
					.strokeColor("#cbd5e1")
					.lineWidth(0.5)
					.stroke()

				doc.y = startY + rowHeight
			}

			drawRow(
				columns.map(c => c.header),
				true
			)
			for (const row of rows) {
				drawRow(
					columns.map(c => this.formatCellValue(row[c.key])),
					false
				)
			}

			doc.end()
		})
	}

	private formatCellValue(value: unknown): string {
		if (value === null || value === undefined) return ""
		if (Array.isArray(value)) return value.join(", ")
		if (value instanceof Date) return value.toISOString()
		return String(value)
	}

	private buildZip(entries: { name: string; data: Buffer }[]): Buffer {
		const localParts: Buffer[] = []
		const centralParts: Buffer[] = []
		let offset = 0

		for (const entry of entries) {
			const nameBuf = Buffer.from(entry.name, "utf8")
			const compressed = deflateRawSync(entry.data)
			const crc = this.crc32(entry.data)

			const localHeader = Buffer.alloc(30)
			localHeader.writeUInt32LE(0x04034b50, 0)
			localHeader.writeUInt16LE(20, 4)
			localHeader.writeUInt16LE(0, 6)
			localHeader.writeUInt16LE(8, 8) // deflate
			localHeader.writeUInt16LE(0, 10)
			localHeader.writeUInt16LE(0, 12)
			localHeader.writeUInt32LE(crc, 14)
			localHeader.writeUInt32LE(compressed.length, 18)
			localHeader.writeUInt32LE(entry.data.length, 22)
			localHeader.writeUInt16LE(nameBuf.length, 26)
			localHeader.writeUInt16LE(0, 28)

			localParts.push(localHeader, nameBuf, compressed)

			const centralHeader = Buffer.alloc(46)
			centralHeader.writeUInt32LE(0x02014b50, 0)
			centralHeader.writeUInt16LE(20, 4)
			centralHeader.writeUInt16LE(20, 6)
			centralHeader.writeUInt16LE(0, 8)
			centralHeader.writeUInt16LE(8, 10)
			centralHeader.writeUInt16LE(0, 12)
			centralHeader.writeUInt16LE(0, 14)
			centralHeader.writeUInt32LE(crc, 16)
			centralHeader.writeUInt32LE(compressed.length, 20)
			centralHeader.writeUInt32LE(entry.data.length, 24)
			centralHeader.writeUInt16LE(nameBuf.length, 28)
			centralHeader.writeUInt16LE(0, 30)
			centralHeader.writeUInt16LE(0, 32)
			centralHeader.writeUInt16LE(0, 34)
			centralHeader.writeUInt16LE(0, 36)
			centralHeader.writeUInt32LE(0, 38)
			centralHeader.writeUInt32LE(offset, 42)

			centralParts.push(centralHeader, nameBuf)
			offset += localHeader.length + nameBuf.length + compressed.length
		}

		const centralDir = Buffer.concat(centralParts)
		const endRecord = Buffer.alloc(22)
		endRecord.writeUInt32LE(0x06054b50, 0)
		endRecord.writeUInt16LE(0, 4)
		endRecord.writeUInt16LE(0, 6)
		endRecord.writeUInt16LE(entries.length, 8)
		endRecord.writeUInt16LE(entries.length, 10)
		endRecord.writeUInt32LE(centralDir.length, 12)
		endRecord.writeUInt32LE(offset, 16)
		endRecord.writeUInt16LE(0, 20)

		return Buffer.concat([...localParts, centralDir, endRecord])
	}

	private crc32(buf: Buffer): number {
		let crc = 0xffffffff
		for (let i = 0; i < buf.length; i++) {
			crc ^= buf[i]!
			for (let bit = 0; bit < 8; bit++) {
				crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
			}
		}
		return (crc ^ 0xffffffff) >>> 0
	}
}