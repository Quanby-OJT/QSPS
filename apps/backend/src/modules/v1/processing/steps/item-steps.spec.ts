import type { FormField } from "@repo/contracts"

import {
	itemSteps,
	missingRequiredSteps,
	readableStepAnswers,
	type StepExecutor,
} from "./item-steps"

jest.mock("@/common/database/database.client", () => ({ db: {} }))

/** A query that resolves to `rows` however it is chained. */
function query(rows: unknown[]) {
	const chain: Record<string, unknown> = {
		from: () => chain,
		innerJoin: () => chain,
		leftJoin: () => chain,
		where: () => chain,
		orderBy: () => chain,
		limit: () => Promise.resolve(rows),
		then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
			Promise.resolve(rows).then(resolve, reject),
	}
	return chain
}

/** An executor whose select and selectDistinct answer these row sets in order. */
function executor(...rowSets: unknown[][]) {
	const next = jest.fn()
	for (const rows of rowSets) next.mockReturnValueOnce(query(rows))
	next.mockReturnValue(query([]))
	return { select: next, selectDistinct: next } as unknown as StepExecutor & {
		select: jest.Mock
	}
}

const resultField = (id: number, label: string, position: number, type = "text") => ({
	id,
	formTemplateId: 50,
	type,
	label,
	required: true,
	options: null,
	position,
})

describe("item steps (PRC-4)", () => {
	describe("readableStepAnswers", () => {
		const fields: FormField[] = [
			{ id: 1, type: "text", label: "Result", required: true, options: null, position: 0 },
			{ id: 2, type: "yes_no", label: "Fit to travel", required: true, options: null, position: 1 },
			{ id: 3, type: "text", label: "Result", required: false, options: null, position: 2 },
			{ id: 4, type: "text", label: "constructor", required: false, options: null, position: 3 },
		]

		it("labels each answer by its question, in order, keeping repeated labels apart", () => {
			expect(readableStepAnswers(fields, { "1": "Negative", "2": true })).toEqual({
				"Result": "Negative",
				"Fit to travel": "Yes",
				"Result (2)": "Not answered",
				"constructor": "Not answered",
			})
			expect(Object.keys(readableStepAnswers(fields, {}))).toEqual([
				"Result",
				"Fit to travel",
				"Result (2)",
				"constructor",
			])
		})
	})

	describe("itemSteps", () => {
		it("is empty when the Service has no steps, so the screen is as before", async () => {
			const exec = executor([], [])
			await expect(itemSteps(exec, 44, 1)).resolves.toEqual([])
		})

		it("lists each step with its status, current result and earlier versions", async () => {
			const recordedAt = new Date("2026-11-24T02:00:00.000Z")
			const exec = executor(
				// results for the item, highest version first
				[
					{
						id: 9,
						serviceStepId: 3,
						formTemplateId: 50,
						version: 2,
						answers: { "61": "Negative" },
						recordedById: "staff-2",
						recordedByName: "Alex Johnson",
						createdAt: recordedAt,
					},
					{
						id: 8,
						serviceStepId: 3,
						formTemplateId: 50,
						version: 1,
						answers: { "61": "Positive" },
						recordedById: "staff-1",
						recordedByName: "Sam Rivera",
						createdAt: recordedAt,
					},
				],
				// steps
				[
					{ id: 3, name: "Laboratory", position: 0, required: true, isActive: true },
					{ id: 4, name: "X-ray", position: 1, required: false, isActive: true },
				],
				// published forms
				[
					{ id: 50, serviceStepId: 3, version: 1 },
					{ id: 51, serviceStepId: 4, version: 1 },
				],
				// fields of every template used
				[resultField(61, "Result", 0), { ...resultField(62, "Findings", 0), formTemplateId: 51 }]
			)

			const steps = await itemSteps(exec, 44, 1)

			expect(steps).toEqual([
				{
					stepId: 3,
					name: "Laboratory",
					position: 0,
					required: true,
					isActive: true,
					status: "done",
					form: {
						formTemplateId: 50,
						version: 1,
						fields: [expect.objectContaining({ id: 61, label: "Result" })],
					},
					result: expect.objectContaining({
						id: 9,
						version: 2,
						answers: { Result: "Negative" },
						values: { "61": "Negative" },
						recordedBy: { id: "staff-2", name: "Alex Johnson" },
					}),
					history: [
						expect.objectContaining({ id: 8, version: 1, answers: { Result: "Positive" } }),
					],
				},
				expect.objectContaining({
					stepId: 4,
					name: "X-ray",
					required: false,
					status: "pending",
					result: null,
					history: [],
				}),
			])
		})

		it("shows a disabled step's earlier result last, with no form and not required", async () => {
			const exec = executor(
				[
					{
						id: 8,
						serviceStepId: 7,
						formTemplateId: 50,
						version: 1,
						answers: { "61": "Clear" },
						recordedById: "staff-1",
						recordedByName: "Sam Rivera",
						createdAt: new Date(),
					},
				],
				[
					{ id: 7, name: "Old X-ray", position: 0, required: true, isActive: false },
					{ id: 3, name: "Laboratory", position: 1, required: true, isActive: true },
				],
				[{ id: 52, serviceStepId: 3, version: 1 }],
				[resultField(61, "Result", 0), { ...resultField(63, "Result", 0), formTemplateId: 52 }]
			)

			const steps = await itemSteps(exec, 44, 1)

			expect(steps.map(step => step.name)).toEqual(["Laboratory", "Old X-ray"])
			expect(steps[1]).toMatchObject({
				isActive: false,
				required: false,
				status: "done",
				form: null,
				result: expect.objectContaining({ answers: { Result: "Clear" } }),
			})
		})
	})

	describe("missingRequiredSteps", () => {
		it("names the required steps with no result, in order", async () => {
			const exec = executor(
				[
					{ id: 3, name: "Laboratory" },
					{ id: 4, name: "X-ray" },
					{ id: 5, name: "Physician evaluation" },
				],
				[{ serviceStepId: 4 }]
			)
			await expect(missingRequiredSteps(exec, 44)).resolves.toEqual([
				"Laboratory",
				"Physician evaluation",
			])
		})

		it("is empty when the Service has no required steps, without reading results", async () => {
			const exec = executor([])
			await expect(missingRequiredSteps(exec, 44)).resolves.toEqual([])
			expect(exec.select).toHaveBeenCalledTimes(1)
		})
	})
})
