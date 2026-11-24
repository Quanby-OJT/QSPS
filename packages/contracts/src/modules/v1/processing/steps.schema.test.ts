import { describe, expect, it } from "vitest"

import {
	ItemStepSchema,
	MAX_SERVICE_STEPS,
	RecordStepResultSchema,
	SaveServiceStepsSchema,
	StepFieldsInputSchema,
} from "./steps.schema.js"

const question = { type: "text" as const, label: "Result", required: true, options: null }
const step = (name: string, id: number | null = null) => ({
	id,
	name,
	required: true,
	fields: [question],
})

describe("Service Steps (PRC-4)", () => {
	it("accepts an ordered list of steps with result questions, trimming names", () => {
		const parsed = SaveServiceStepsSchema.parse({
			serviceId: "5",
			steps: [step("  Laboratory "), step("X-ray", 4)],
		})
		expect(parsed.serviceId).toBe(5)
		expect(parsed.steps.map(item => item.name)).toEqual(["Laboratory", "X-ray"])
	})

	it("accepts an empty list, which turns steps off", () => {
		expect(SaveServiceStepsSchema.safeParse({ serviceId: 5, steps: [] }).success).toBe(true)
	})

	it("refuses two steps with the same name, ignoring case", () => {
		const result = SaveServiceStepsSchema.safeParse({
			serviceId: 5,
			steps: [step("Laboratory"), step("laboratory ")],
		})
		expect(result.success).toBe(false)
		expect(result.error?.issues[0]?.path).toEqual(["steps", 1, "name"])
	})

	it("refuses the same step listed twice", () => {
		expect(
			SaveServiceStepsSchema.safeParse({
				serviceId: 5,
				steps: [step("Laboratory", 3), step("X-ray", 3)],
			}).success
		).toBe(false)
	})

	it(`refuses more than ${MAX_SERVICE_STEPS} steps`, () => {
		const steps = Array.from({ length: MAX_SERVICE_STEPS + 1 }, (_, index) => step(`Step ${index}`))
		expect(SaveServiceStepsSchema.safeParse({ serviceId: 5, steps }).success).toBe(false)
	})

	it("needs at least one result question, and no file questions", () => {
		expect(StepFieldsInputSchema.safeParse([]).success).toBe(false)
		const withFile = StepFieldsInputSchema.safeParse([
			question,
			{ type: "file", label: "Scan", required: false, options: null },
		])
		expect(withFile.success).toBe(false)
		expect(withFile.error?.issues[0]?.path).toEqual([1, "type"])
	})

	it("records a result keyed by question id", () => {
		expect(
			RecordStepResultSchema.parse({
				bookingItemId: "44",
				stepId: "3",
				formTemplateId: 50,
				answers: { "61": "Negative", "62": true },
			})
		).toEqual({
			bookingItemId: 44,
			stepId: 3,
			formTemplateId: 50,
			answers: { "61": "Negative", "62": true },
		})
		expect(
			RecordStepResultSchema.safeParse({
				bookingItemId: 44,
				stepId: 3,
				formTemplateId: 50,
				answers: { Result: "Negative" },
			}).success
		).toBe(false)
	})

	it("reads a recorded result's date from the API", () => {
		const parsed = ItemStepSchema.parse({
			stepId: 3,
			name: "Laboratory",
			position: 0,
			required: true,
			isActive: true,
			status: "done",
			form: null,
			result: {
				id: 9,
				version: 2,
				formTemplateId: 50,
				answers: { Result: "Negative" },
				values: { "61": "Negative" },
				recordedBy: { id: "staff-1", name: "Alex Johnson" },
				recordedAt: "2026-11-24T02:00:00.000Z",
			},
			history: [],
		})
		expect(parsed.result?.recordedAt).toEqual(new Date("2026-11-24T02:00:00.000Z"))
	})
})
