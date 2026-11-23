import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { BookingForm, FormAnswerValue } from "@repo/contracts"

import { QuestionnaireFields } from "./questionnaire-fields"

const form: BookingForm = {
	serviceId: 1,
	formTemplateId: 11,
	version: 2,
	fields: [
		{ id: 100, type: "text", label: "Full name", required: true, options: null, position: 0 },
		{
			id: 101,
			type: "yes_no",
			label: "Travelled abroad",
			required: false,
			options: null,
			position: 1,
		},
		{
			id: 102,
			type: "multiple_choice",
			label: "Symptoms",
			required: false,
			options: ["Fever", "Cough"],
			position: 2,
		},
	],
}

function renderFields(
	values: Record<string, FormAnswerValue> = {},
	errors: Record<string, string> = {}
) {
	const onChange = vi.fn()
	const view = render(
		<QueryClientProvider client={new QueryClient()}>
			<QuestionnaireFields
				form={form}
				values={values}
				errors={errors}
				onChange={onChange}
				idPrefix="q1"
			/>
		</QueryClientProvider>
	)
	return { onChange, ...view }
}

describe("QuestionnaireFields", () => {
	it("renders the questions in order and marks the required ones", () => {
		const { container } = renderFields()
		const text = container.textContent ?? ""
		expect(text.indexOf("Full name")).toBeLessThan(text.indexOf("Travelled abroad"))
		expect(text.indexOf("Travelled abroad")).toBeLessThan(text.indexOf("Symptoms"))
		expect(screen.getByLabelText(/Full name/)).toBeTruthy()
		expect(screen.getAllByText("(required)")).toHaveLength(1)
	})

	it("flags an invalid question", () => {
		renderFields({}, { "100": "This question is required" })
		expect(screen.getByText("This question is required")).toBeTruthy()
		expect(screen.getByLabelText(/Full name/).getAttribute("aria-invalid")).toBe("true")
	})

	it("reports each answer with its question's type", () => {
		const { onChange } = renderFields({ "102": ["Fever"] })

		fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "Ana" } })
		fireEvent.click(screen.getByLabelText("Yes"))
		fireEvent.click(screen.getByLabelText("Cough"))

		expect(onChange).toHaveBeenCalledWith("100", "Ana")
		expect(onChange).toHaveBeenCalledWith("101", true)
		expect(onChange).toHaveBeenCalledWith("102", ["Fever", "Cough"])
	})
})
