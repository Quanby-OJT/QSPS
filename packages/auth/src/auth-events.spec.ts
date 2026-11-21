import { afterEach, describe, expect, it, vi } from "vitest"

import { emitAuthEvent, setAuthEventListener } from "./auth-events"

afterEach(() => {
	setAuthEventListener(null)
	vi.restoreAllMocks()
})

describe("auth events", () => {
	it("drops events when no listener is registered", async () => {
		await expect(emitAuthEvent({ type: "user.registered", userId: "u1" })).resolves.toBeUndefined()
	})

	it("hands each event to the registered listener", async () => {
		const listener = vi.fn()
		setAuthEventListener(listener)

		await emitAuthEvent({ type: "session.created", userId: "u1" })

		expect(listener).toHaveBeenCalledWith({ type: "session.created", userId: "u1" })
	})

	it("passes MFA events through with their method (AUTH-2)", async () => {
		const listener = vi.fn()
		setAuthEventListener(listener)

		await emitAuthEvent({ type: "mfa.failed", userId: "u1", method: "totp" })

		expect(listener).toHaveBeenCalledWith({ type: "mfa.failed", userId: "u1", method: "totp" })
	})

	it("logs a failing listener instead of failing the auth flow", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
		setAuthEventListener(() => {
			throw new Error("database unavailable")
		})

		await expect(
			emitAuthEvent({ type: "user.email_verified", userId: "u1" })
		).resolves.toBeUndefined()
		expect(error).toHaveBeenCalledOnce()
	})
})
