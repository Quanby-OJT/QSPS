import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { ReportsController } from "./reports.controller"

jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))

jest.mock("@orpc/server", () => ({
	implement: jest.fn(() => ({ handler: jest.fn() })),
}))

jest.mock("@thallesp/nestjs-better-auth", () => ({
	Session: () => () => undefined,
}))

jest.mock("@/config/api-versions.config", () => ({
	v1: { reports: { dashboard: {} } },
}))

jest.mock("@/common/scope/scope.service", () => ({
	ScopeService: jest.fn(),
}))

jest.mock("./reports.service", () => ({
	ReportsService: jest.fn(),
}))

describe("ReportsController permissions", () => {
	it("requires reports.dashboard:read for the dashboard", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ReportsController.prototype.dashboard)
		).toEqual(["reports.dashboard:read"])
	})
})