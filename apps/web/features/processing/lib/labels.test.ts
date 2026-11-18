import { describe, expect, it } from "vitest"

import { canOpen, correctionsFromRows, itemStatusLabel, outcomeLabel } from "./labels"

describe("processing labels", () => {
	it("names every item status in plain words", () => {
		expect(itemStatusLabel("checked_in")).toBe("Checked in")
		expect(itemStatusLabel("pending_head_approval")).toBe("Awaiting head approval")
		expect(outcomeLabel("returned")).toBe("Returned for correction")
	})

	it("lets staff open only checked-in or returned items", () => {
		expect(canOpen("checked_in")).toBe(true)
		expect(canOpen("returned")).toBe(true)
		expect(canOpen("booked")).toBe(false)
		expect(canOpen("in_assessment")).toBe(false)
		expect(canOpen("cleared")).toBe(false)
	})
})

describe("correctionsFromRows", () => {
	it("drops blank rows and trims what is left", () => {
		expect(
			correctionsFromRows([
				{ field: " Birth date ", value: " 1990-02-01 " },
				{ field: "", value: "ignored" },
				{ field: "   ", value: "" },
			])
		).toEqual({ "Birth date": "1990-02-01" })
	})

	it("keeps the last value when a field is repeated", () => {
		expect(
			correctionsFromRows([
				{ field: "Name", value: "Juan" },
				{ field: "Name", value: "Juan Dela Cruz" },
			])
		).toEqual({ Name: "Juan Dela Cruz" })
	})
})
