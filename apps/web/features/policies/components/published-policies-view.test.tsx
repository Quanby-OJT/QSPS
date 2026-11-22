import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PolicyDocumentSummary } from "@repo/contracts"

import { PublishedPoliciesView } from "./published-policies-view"

const usePublished = vi.hoisted(() =>
	vi.fn<
		() => {
			data: PolicyDocumentSummary[] | undefined
			isPending: boolean
			isLoading: boolean
			isError: boolean
			refetch: () => void
		}
	>()
)

vi.mock("@/features/policies/api/policy-documents.hooks", () => ({
	usePublishedPoliciesQuery: usePublished,
}))

const terms: PolicyDocumentSummary = {
	id: 4,
	documentKey: "3f1c2b7e-8a4d-4e5f-9b6a-0c1d2e3f4a5b",
	version: 2,
	title: "Terms of booking",
	body: "Arrive 15 minutes early.\n\n<b>Bring</b> a valid ID.",
	requiresAcceptance: true,
	effectiveFrom: "2026-11-01",
	appliesToAllServices: false,
	serviceNames: ["Yellow fever vaccination"],
}

function loaded(data: PolicyDocumentSummary[]) {
	usePublished.mockReturnValue({
		data,
		isPending: false,
		isLoading: false,
		isError: false,
		refetch: vi.fn(),
	})
}

describe("PublishedPoliciesView (ADM-9)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("lists each policy in effect with what it applies to", () => {
		loaded([terms])
		render(<PublishedPoliciesView />)

		expect(screen.getByRole("heading", { name: "Terms of booking" })).toBeInTheDocument()
		expect(screen.getByText(/Yellow fever vaccination · in effect since/)).toBeInTheDocument()
		expect(screen.getByText("Arrive 15 minutes early.")).toBeInTheDocument()
	})

	it("shows markup in the text as plain text, never as HTML", () => {
		loaded([terms])
		const { container } = render(<PublishedPoliciesView />)
		expect(screen.getByText("<b>Bring</b> a valid ID.")).toBeInTheDocument()
		expect(container.querySelector("b")).toBeNull()
	})

	it("says so when nothing is published", () => {
		loaded([])
		render(<PublishedPoliciesView />)
		expect(screen.getByText("No policies published")).toBeInTheDocument()
	})
})
