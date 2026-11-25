export const WATER_TESTING_SERVICE_CODE = "WATER-TESTING"
export const WATER_LAB_STEP = "Laboratory analysis"
export const WATER_RESULT_FIELD =
	"Parameters: Name | Result | Pass or Fail. Separate rows with semicolons."

export type WaterOutcome = "pass" | "fail"

export interface WaterParameter {
	name: string
	result: string
	outcome: WaterOutcome
}

export type WaterAnalysisParse =
	| { ok: true; parameters: WaterParameter[]; outcome: WaterOutcome }
	| { ok: false; message: string }

export function parseWaterAnalysis(value: unknown): WaterAnalysisParse {
	if (typeof value !== "string" || value.trim().length === 0) {
		return { ok: false, message: "Record at least one parameter." }
	}

	if (value.length > 1000) {
		return { ok: false, message: "Use at most 1,000 characters." }
	}

	const rows = value
		.trim()
		.split(/[;\r\n]+/)
		.map(row => row.trim())
		.filter(Boolean)
	if (rows.length === 0) {
		return { ok: false, message: "Record at least one parameter." }
	}

	const parameters: WaterParameter[] = []
	const names = new Set<string>()

	for (const [index, row] of rows.entries()) {
		const parts = row.split("|").map(part => part.trim())
		const [name, result, rawOutcome] = parts
		const outcome = rawOutcome?.toLowerCase()

		if (parts.length !== 3 || !name || !result || (outcome !== "pass" && outcome !== "fail")) {
			return {
				ok: false,
				message: `Parameter ${index + 1} must use Name | Result | Pass or Fail.`,
			}
		}

		const key = name.toLowerCase()
		if (names.has(key)) {
			return { ok: false, message: `Parameter ${index + 1} repeats a parameter name.` }
		}
		names.add(key)
		parameters.push({ name, result, outcome })
	}

	return {
		ok: true,
		parameters,
		outcome: parameters.some(parameter => parameter.outcome === "fail") ? "fail" : "pass",
	}
}
