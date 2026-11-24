import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PRIVACY_NOTICE_VERSION } from "@repo/contracts"

import { PrivacyNoticeForm } from "./privacy-notice-form"

const push = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push, refresh: vi.fn() }),
}))

function renderForm() {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	})
	return render(
		<QueryClientProvider client={queryClient}>
			<PrivacyNoticeForm />
		</QueryClientProvider>
	)
}

const fetchMock = vi.fn()

beforeEach(() => {
	push.mockReset()
	fetchMock.mockReset()
	vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("PrivacyNoticeForm (PRC-2b)", () => {
	it("cannot be accepted until the notice is ticked", async () => {
		renderForm()
		const button = screen.getByRole("button", { name: /accept and continue/i })
		expect(button).toBeDisabled()

		await userEvent.setup().click(screen.getByLabelText(/i have read and accept/i))
		expect(button).toBeEnabled()
	})

	it("sends the current version and enters the portal", async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
		renderForm()
		const user = userEvent.setup()
		await user.click(screen.getByLabelText(/i have read and accept/i))
		await user.click(screen.getByRole("button", { name: /accept and continue/i }))

		await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"))
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
		expect(url).toMatch(/\/me\/privacy-notice$/)
		expect(JSON.parse(String(init.body))).toEqual({ privacyNoticeVersion: PRIVACY_NOTICE_VERSION })
	})

	it("shows the refusal and stays on the page", async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({ message: "Please read and accept the current Privacy Notice" }),
				{
					status: 400,
				}
			)
		)
		renderForm()
		const user = userEvent.setup()
		await user.click(screen.getByLabelText(/i have read and accept/i))
		await user.click(screen.getByRole("button", { name: /accept and continue/i }))

		expect(await screen.findByRole("alert")).toHaveTextContent(/current privacy notice/i)
		expect(push).not.toHaveBeenCalled()
	})
})
