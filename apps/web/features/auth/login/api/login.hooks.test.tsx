import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { RateLimitError } from "@/core/lib/rate-limit-utils"
import {
	resolveBetterFetchRateLimit,
	type AuthFetchArg,
} from "@/features/auth/api/better-fetch-rate-limit-mock"

const { signInEmail, replaceLocation, routerReplace } = vi.hoisted(() => ({
	signInEmail: vi.fn(),
	replaceLocation: vi.fn(),
	routerReplace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: routerReplace }),
}))

vi.mock("@/core/lib/navigate", () => ({ replaceLocation }))

vi.mock("@/services/better-auth/auth-client", () => ({
	TWO_FACTOR_CHALLENGE_PATH: "/two-factor",
	authClient: {
		signIn: { email: (input: AuthFetchArg) => signInEmail(input) },
	},
}))

const { useLoginMutation } = await import("./login.hooks")

function renderLogin() {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	})
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	)
	return renderHook(() => useLoginMutation(), { wrapper })
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe("useLoginMutation rate limit", () => {
	it("throws RateLimitError with the captured X-Retry-After when the error has no headers", async () => {
		signInEmail.mockImplementation((input: AuthFetchArg) =>
			resolveBetterFetchRateLimit(input, "http://localhost:3000/api/v1/auth/sign-in/email")
		)

		const { result } = renderLogin()
		result.current.mutate({ email: "a@example.com", password: "secret" })

		await waitFor(() => expect(result.current.isError).toBe(true))

		expect(result.current.error).toBeInstanceOf(RateLimitError)
		expect((result.current.error as RateLimitError).retryAfter).toBe(10)
		const returned = await signInEmail.mock.results[0]?.value
		expect(returned.error).not.toHaveProperty("headers")
		expect(returned.error).toEqual({
			status: 429,
			statusText: "Too Many Requests",
			message: "Too many requests. Please try again later.",
		})
	})
})

describe("useLoginMutation redirect (AUTH-2)", () => {
	it("continues to the code step when the account uses two-factor authentication", async () => {
		signInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null })

		const { result } = renderLogin()
		result.current.mutate({ email: "a@example.com", password: "secret" })

		await waitFor(() => expect(result.current.isSuccess).toBe(true))
		expect(routerReplace).toHaveBeenCalledWith("/two-factor")
		expect(replaceLocation).not.toHaveBeenCalled()
	})

	it("goes straight to the dashboard when no code is needed", async () => {
		signInEmail.mockResolvedValue({ data: { token: "t", user: { id: "u1" } }, error: null })

		const { result } = renderLogin()
		result.current.mutate({ email: "a@example.com", password: "secret" })

		await waitFor(() => expect(result.current.isSuccess).toBe(true))
		expect(replaceLocation).toHaveBeenCalledWith("/dashboard")
	})
})
