import { displayAnswer, readableAnswers } from "./form-answers-display"

function fakeExecutor(selects: unknown[][]) {
	const select = jest.fn(() => {
		const rows = selects.shift() ?? []
		const chain: Record<string, unknown> = {
			from: () => chain,
			where: () => chain,
			orderBy: () => chain,
			limit: () => Promise.resolve(rows),
			then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
				Promise.resolve(rows).then(resolve, reject),
		}
		return chain
	})
	return { select } as never
}

describe("displayAnswer", () => {
	it("shows each type the way staff read it", () => {
		expect(displayAnswer("text", "Lee")).toBe("Lee")
		expect(displayAnswer("number", 22)).toBe("22")
		expect(displayAnswer("yes_no", true)).toBe("Yes")
		expect(displayAnswer("yes_no", false)).toBe("No")
		expect(displayAnswer("multiple_choice", ["Kenya", "Brazil"])).toBe("Kenya, Brazil")
		expect(displayAnswer("file", "form-uploads/u1/a.pdf")).toBe("File attached")
		expect(displayAnswer("text", undefined)).toBe("Not answered")
		expect(displayAnswer("multiple_choice", [])).toBe("Not answered")
	})
})

describe("readableAnswers", () => {
	it("is empty when the item has no submission", async () => {
		await expect(readableAnswers(fakeExecutor([[]]), 149)).resolves.toEqual({})
	})

	it("labels answers by question, in question order, keeping duplicate labels", async () => {
		const executor = fakeExecutor([
			[{ formTemplateId: 3, answers: { "13": "Lee", "17": true, "20": "form-uploads/u1/a.jpg" } }],
			[
				{ id: 13, type: "text", label: "Full name" },
				{ id: 17, type: "yes_no", label: "Vaccinated before?" },
				{ id: 18, type: "text", label: "Full name" },
				{ id: 20, type: "file", label: "Vaccination card scan" },
			],
		])

		const answers = await readableAnswers(executor, 149)

		expect(Object.entries(answers)).toEqual([
			["Full name", "Lee"],
			["Vaccinated before?", "Yes"],
			["Full name (2)", "Not answered"],
			["Vaccination card scan", "File attached"],
		])
	})
})
