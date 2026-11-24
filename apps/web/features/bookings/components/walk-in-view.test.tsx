import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PRIVACY_NOTICE_VERSION, type WalkInClient } from "@repo/contracts"

import { WalkInView } from "./walk-in-view"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mobileOnlyClient: WalkInClient = {
	id: "client-9",
	name: "Maria Santos",
	email: null,
	mobile: "09171234567",
	birthDate: "1990-02-01",
	nationality: "Filipino",
	gender: "Female",
	invitationPending: true,
}

const fetchMock = vi.fn()

function json(body: unknown, status = 200) {
	return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

/** Answers the walk-in API: no client found, and the account it creates. */
function routeFetch(created: WalkInClient = mobileOnlyClient) {
	fetchMock.mockImplementation((url: string, init?: RequestInit) => {
		if (url.includes("/walk-in/clients/") && init?.method === "PUT") {
			const { email } = JSON.parse(String(init.body)) as { email: string }
			return json({ ...created, email })
		}
		if (url.includes("/walk-in/clients") && init?.method === "POST") return json(created)
		if (url.includes("/walk-in/clients")) return json([])
		return json([])
	})
}

function renderView() {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	})
	return render(
		<QueryClientProvider client={queryClient}>
			<WalkInView />
		</QueryClientProvider>
	)
}

/** Search for a mobile number nobody has, open the new-client form and fill it. */
async function fillNewMobileOnlyClient() {
	const user = userEvent.setup()
	await user.type(screen.getByLabelText(/email address or mobile number/i), "09171234567")
	await user.click(screen.getByRole("button", { name: /find client/i }))
	await user.click(await screen.findByRole("button", { name: /create the client's account/i }))
	await user.type(screen.getByLabelText(/full name/i), "Maria Santos")
	await user.type(screen.getByLabelText(/birth date/i), "1990-02-01")
	await user.type(screen.getByLabelText(/nationality/i), "Filipino")
	await user.type(screen.getByLabelText(/^gender/i), "Female")
	return user
}

function createCalls() {
	return fetchMock.mock.calls.filter(
		([url, init]) =>
			String(url).endsWith("/walk-in/clients") && (init as RequestInit)?.method === "POST"
	)
}

beforeEach(() => {
	fetchMock.mockReset()
	vi.stubGlobal("fetch", fetchMock)
	routeFetch()
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("WalkInView new client (PRC-2b)", () => {
	it("cannot be submitted until the Privacy Notice tick is given", async () => {
		renderView()
		const user = await fillNewMobileOnlyClient()

		const submit = screen.getByRole("button", { name: /create account and continue/i })
		expect(submit).toBeDisabled()
		expect(createCalls()).toHaveLength(0)

		await user.click(screen.getByLabelText(/client accepted the privacy notice/i))
		expect(submit).toBeEnabled()
	})

	it("creates a mobile-only client with the notice version, and shows No email", async () => {
		renderView()
		const user = await fillNewMobileOnlyClient()
		await user.click(screen.getByLabelText(/client accepted the privacy notice/i))
		await user.click(screen.getByRole("button", { name: /create account and continue/i }))

		await waitFor(() => expect(createCalls()).toHaveLength(1))
		const body = JSON.parse(String((createCalls()[0]?.[1] as RequestInit).body)) as Record<
			string,
			unknown
		>
		expect(body).toMatchObject({
			email: null,
			mobile: "09171234567",
			privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
		})
		expect(body).not.toHaveProperty("privacyAccepted")

		expect(await screen.findByText(/^No email/)).toBeInTheDocument()
		expect(screen.queryByText(/no-email\.invalid/)).not.toBeInTheDocument()
		expect(screen.queryByText(/invitation sent/i)).not.toBeInTheDocument()
	})

	it("adds a real email to the mobile-only client", async () => {
		renderView()
		const user = await fillNewMobileOnlyClient()
		await user.click(screen.getByLabelText(/client accepted the privacy notice/i))
		await user.click(screen.getByRole("button", { name: /create account and continue/i }))

		await user.type(
			await screen.findByRole("textbox", { name: /add the client's email address/i }),
			"Maria@Example.com"
		)
		await user.click(screen.getByRole("button", { name: /^add email$/i }))

		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringMatching(/\/walk-in\/clients\/client-9\/email$/),
				expect.objectContaining({
					method: "PUT",
					body: JSON.stringify({ email: "maria@example.com" }),
				})
			)
		)
		expect(await screen.findByText(/^maria@example\.com/)).toBeInTheDocument()
		expect(
			screen.queryByRole("textbox", { name: /add the client's email address/i })
		).not.toBeInTheDocument()
	})
})
