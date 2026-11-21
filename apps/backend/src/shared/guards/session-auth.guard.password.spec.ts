import { ForbiddenException, type ExecutionContext } from "@nestjs/common"
import { Reflector } from "@nestjs/core"

import { ALLOW_WITHOUT_PASSWORD_CHANGE_KEY } from "./allow-without-password-change"
import { resolveRequestSession, type RequestSession } from "./resolve-request-session"
import { PASSWORD_CHANGE_REQUIRED, SessionAuthGuard } from "./session-auth.guard"

// better-auth ships ESM only; Jest runs CommonJS, so stub what the guard imports.
jest.mock("better-auth/node", () => ({ fromNodeHeaders: jest.fn(() => new Headers()) }))
jest.mock("@repo/auth", () => ({ getAuth: jest.fn() }))
jest.mock("./resolve-request-session", () => ({ resolveRequestSession: jest.fn() }))

const mockedResolve = resolveRequestSession as jest.MockedFunction<typeof resolveRequestSession>

class Controller {
	open() {}
	changeFlow() {}
}
Reflect.defineMetadata(ALLOW_WITHOUT_PASSWORD_CHANGE_KEY, true, Controller.prototype.changeFlow)

function contextFor(handler: () => void): ExecutionContext {
	return {
		getType: () => "http",
		getHandler: () => handler,
		getClass: () => Controller,
		switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
	} as unknown as ExecutionContext
}

function sessionOf(user: Record<string, unknown>): RequestSession {
	return { user: { id: "user-1", ...user } } as unknown as RequestSession
}

describe("SessionAuthGuard forced password change (AUTH-3)", () => {
	const guard = new SessionAuthGuard(new Reflector())

	afterEach(() => mockedResolve.mockReset())

	it("refuses an account that must set a new password", async () => {
		mockedResolve.mockResolvedValue(
			sessionOf({ accountType: "staff", twoFactorEnabled: true, mustResetPassword: true })
		)

		const attempt = guard.canActivate(contextFor(Controller.prototype.open))

		await expect(attempt).rejects.toBeInstanceOf(ForbiddenException)
		await expect(attempt).rejects.toMatchObject({ response: { code: PASSWORD_CHANGE_REQUIRED } })
	})

	it("asks for the password change before MFA enrolment", async () => {
		mockedResolve.mockResolvedValue(
			sessionOf({ accountType: "staff", twoFactorEnabled: false, mustResetPassword: true })
		)

		await expect(guard.canActivate(contextFor(Controller.prototype.open))).rejects.toMatchObject({
			response: { code: PASSWORD_CHANGE_REQUIRED },
		})
	})

	it("allows routes marked @AllowWithoutPasswordChange", async () => {
		mockedResolve.mockResolvedValue(
			sessionOf({ accountType: "client", mustResetPassword: true })
		)

		await expect(guard.canActivate(contextFor(Controller.prototype.changeFlow))).resolves.toBe(true)
	})

	it("allows the account once the password is changed", async () => {
		mockedResolve.mockResolvedValue(
			sessionOf({ accountType: "staff", twoFactorEnabled: true, mustResetPassword: false })
		)

		await expect(guard.canActivate(contextFor(Controller.prototype.open))).resolves.toBe(true)
	})
})