import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { twoFactor, replaceLocation } = vi.hoisted(() => ({
	twoFactor: {
		verifyTotp: vi.fn(),
		verifyOtp: vi.fn(),
		verifyBackupCode: vi.fn(),
		sendOtp: vi.fn(),
	},
	replaceLocation: vi.fn(),
}))

vi.mock("@/core/lib/navigate", () => ({ replaceLocation }))
vi.mock("@/services/better-auth/auth-client", () => ({ authClient: { twoFactor } }))

const { ChallengeExpiredError, useVerifyTwoFactorMutation } = await import("./two-factor.hooks")

function renderVerify() {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	})
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	)
	return renderHook(() => useVerifyTwoFactorMutation(), { wrapper })
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe("useVerifyTwoFactorMutation (AUTH-2)", () => {
	it.each([
		["totp", "verifyTotp"],
		["otp", "verifyOtp"],
		["backup_code", "verifyBackupCode"],
	] as const)("sends a %s code to %s and opens the dashboard", async (method, call) => {
		twoFactor[call].mockResolvedValue({ data: { token: "t" }, error: null })

		const { result } = renderVerify()
		result.current.mutate({ method, code: "123456" })

		await waitFor(() => expect(result.current.isSuccess).toBe(true))
		expect(twoFactor[call]).toHaveBeenCalledWith(expect.objectContaining({ code: "123456" }))
		expect(replaceLocation).toHaveBeenCalledWith("/dashboard")
	})

	it("asks the user to sign in again when the challenge has expired", async () => {
		twoFactor.verifyTotp.mockResolvedValue({
			data: null,
			error: {
				status: 401,
				statusText: "Unauthorized",
				code: "INVALID_TWO_FACTOR_COOKIE",
				message: "Invalid two factor cookie",
			},
		})

		const { result } = renderVerify()
		result.current.mutate({ method: "totp", code: "123456" })

		await waitFor(() => expect(result.current.isError).toBe(true))
		expect(result.current.error).toBeInstanceOf(ChallengeExpiredError)
		expect(replaceLocation).not.toHaveBeenCalled()
	})

	it("shows the server's message for a wrong code", async () => {
		twoFactor.verifyOtp.mockResolvedValue({
			data: null,
			error: { status: 401, statusText: "Unauthorized", message: "Invalid code" },
		})

		const { result } = renderVerify()
		result.current.mutate({ method: "otp", code: "000000" })

		await waitFor(() => expect(result.current.isError).toBe(true))
		expect(result.current.error?.message).toBe("Invalid code")
		expect(replaceLocation).not.toHaveBeenCalled()
	})
})
