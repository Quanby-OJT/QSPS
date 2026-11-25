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
	v1: {
		reports: {
			dashboard: {},
			listTransactions: {},
			transactionDetail: {},
			exportTransactions: {},
		},
	},
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

	it("requires reports.transactions:read for the transaction list", () => {
		expect(
			Reflect.getMetadata(
				REQUIRED_PERMISSIONS_KEY,
				ReportsController.prototype.listTransactions
			)
		).toEqual(["reports.transactions:read"])
	})

	it("requires reports.transactions:read and bookings.all:read for transaction detail", () => {
		expect(
			Reflect.getMetadata(
				REQUIRED_PERMISSIONS_KEY,
				ReportsController.prototype.transactionDetail
			)
		).toEqual(["reports.transactions:read", "bookings.all:read"])
	})

	it("requires reports.transactions:read for transaction export", () => {
		expect(
			Reflect.getMetadata(
				REQUIRED_PERMISSIONS_KEY,
				ReportsController.prototype.exportTransactions
			)
		).toEqual(["reports.transactions:read"])
	})
})