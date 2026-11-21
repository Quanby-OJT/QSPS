import { ForbiddenException, type ExecutionContext } from "@nestjs/common"
import { Reflector } from "@nestjs/core"

import { ALLOW_WITHOUT_MFA_KEY } from "./allow-without-mfa"
import { resolveRequestSession, type RequestSession } from "./resolve-request-session"
import { MFA_ENROLMENT_REQUIRED, SessionAuthGuard } from "./session-auth.guard"

// better-auth ships ESM only; Jest runs CommonJS, so stub what the guard imports.
jest.mock("better-auth/node", () => ({ fromNodeHeaders: jest.fn(() => new Headers()) }))
jest.mock("@repo/auth", () => ({ getAuth: jest.fn() }))
jest.mock("./resolve-request-session", () => ({ resolveRequestSession: jest.fn() }))

const mockedResolve = resolveRequestSession as jest.MockedFunction<typeof resolveRequestSession>

class Controller {
	open() {}
	enrolment() {}
}
Reflect.defineMetadata(ALLOW_WITHOUT_MFA_KEY, true, Controller.prototype.enrolment)

function contextFor(handler: () => void): ExecutionContext {
	return {
		getType: () => "http",
		getHandler: () => handler,
		getClass: () => Controller,
		switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
	} as unknown as ExecutionContext
}

function sessionOf(user: RequestSession["user"]): RequestSession {
	return { user: { id: "user-1", ...user } }
}

describe("SessionAuthGuard staff MFA rule (AUTH-2)", () => {
	const guard = new SessionAuthGuard(new Reflector())

	afterEach(() => mockedResolve.mockReset())

	it("refuses a staff account without two-factor authentication", async () => {
		mockedResolve.mockResolvedValue(sessionOf({ accountType: "staff", twoFactorEnabled: false }))

		const attempt = guard.canActivate(contextFor(Controller.prototype.open))

		await expect(attempt).rejects.toBeInstanceOf(ForbiddenException)
		await expect(attempt).rejects.toMatchObject({
			response: { code: MFA_ENROLMENT_REQUIRED },
		})
	})

	it("treats a missing flag as not enrolled", async () => {
		mockedResolve.mockResolvedValue(sessionOf({ accountType: "staff" }))

		await expect(guard.canActivate(contextFor(Controller.prototype.open))).rejects.toMatchObject({
			response: { code: MFA_ENROLMENT_REQUIRED },
		})
	})

	it("allows a staff account once two-factor authentication is on", async () => {
		mockedResolve.mockResolvedValue(sessionOf({ accountType: "staff", twoFactorEnabled: true }))

		await expect(guard.canActivate(contextFor(Controller.prototype.open))).resolves.toBe(true)
	})

	it("allows a staff account without it on routes marked @AllowWithoutMfa", async () => {
		mockedResolve.mockResolvedValue(sessionOf({ accountType: "staff", twoFactorEnabled: false }))

		await expect(guard.canActivate(contextFor(Controller.prototype.enrolment))).resolves.toBe(true)
	})

	it("does not require it from client accounts", async () => {
		mockedResolve.mockResolvedValue(sessionOf({ accountType: "client", twoFactorEnabled: false }))

		await expect(guard.canActivate(contextFor(Controller.prototype.open))).resolves.toBe(true)
	})
})