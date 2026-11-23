import { FormSubmissionService } from "./form-submissions.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			public readonly options: { message: string; data?: unknown }
		) {
			super(options.message)
		}
	},
}))

// The answer rules only; the full contracts barrel pulls in ESM-only oRPC.
jest.mock("@repo/contracts", () =>
	jest.requireActual("../../../../../../packages/contracts/src/modules/v1/forms/form-answers")
)

jest.mock("@/common/database/database.client", () => ({ db: {} }))

const KEY = "form-uploads/user_1/0b6f7a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b.pdf"

const fieldRows = [
	{
		id: 100,
		formTemplateId: 11,
		type: "text",
		label: "Full name",
		required: true,
		options: null,
		position: 0,
	},
	{
		id: 101,
		formTemplateId: 11,
		type: "file",
		label: "Passport scan",
		required: false,
		options: null,
		position: 1,
	},
]

/** Each select answers the next entry, however the query ends. */
function fakeExecutor(selects: unknown[][]) {
	const lock = jest.fn()
	const select = jest.fn(() => {
		const rows = selects.shift() ?? []
		const chain: Record<string, unknown> = {
			from: () => chain,
			where: () => chain,
			orderBy: () => chain,
			limit: () => Promise.resolve(rows),
			for: (mode: string) => {
				lock(mode)
				return Promise.resolve(rows)
			},
			then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
				Promise.resolve(rows).then(resolve, reject),
		}
		return chain
	})
	return { executor: { select } as never, lock }
}

function setup(owns = true) {
	const uploads = { ownsUpload: jest.fn().mockResolvedValue(owns) }
	return { uploads, service: new FormSubmissionService(uploads as never) }
}

const base = {
	serviceId: 1,
	serviceName: "Yellow fever vaccination",
	actorId: "user_1",
	errorData: { scheduleSlotId: 7 },
}

type Refusal = { message: string; options: { data: Record<string, unknown> } }

async function refusal(promise: Promise<unknown>): Promise<Refusal> {
	try {
		await promise
	} catch (error) {
		return error as Refusal
	}
	throw new Error("expected a refusal")
}

describe("FormSubmissionService.prepare", () => {
	it("returns null when the Service has no active questionnaire", async () => {
		const { service } = setup()
		const { executor } = fakeExecutor([[]])
		await expect(service.prepare(executor, { ...base, form: undefined })).resolves.toBeNull()
	})

	it("share-locks the active version and returns the checked answers", async () => {
		const { service, uploads } = setup()
		const { executor, lock } = fakeExecutor([[{ id: 11, version: 2 }], fieldRows])

		const prepared = await service.prepare(executor, {
			...base,
			form: { formTemplateId: 11, answers: { "100": " Ana ", "101": KEY, "999": "extra" } },
		})

		expect(lock).toHaveBeenCalledWith("share")
		expect(prepared).toEqual({
			formTemplateId: 11,
			version: 2,
			answers: { "100": "Ana", "101": KEY },
		})
		expect(uploads.ownsUpload).toHaveBeenCalledWith(KEY, "user_1")
	})

	it("refuses missing answers as a changed form, naming the slot", async () => {
		const { service } = setup()
		const { executor } = fakeExecutor([[{ id: 11, version: 2 }], fieldRows])
		const error = await refusal(service.prepare(executor, { ...base, form: undefined }))
		expect(error.message).toBe("Please answer the questionnaire for Yellow fever vaccination.")
		expect(error.options.data).toEqual({ scheduleSlotId: 7, serviceId: 1, formChanged: true })
	})

	it("refuses answers to an older version", async () => {
		const { service } = setup()
		const { executor } = fakeExecutor([[{ id: 11, version: 2 }], fieldRows])
		const error = await refusal(
			service.prepare(executor, { ...base, form: { formTemplateId: 10, answers: {} } })
		)
		expect(error.message).toContain("was updated while you were booking")
		expect(error.options.data.formChanged).toBe(true)
	})

	it("flags each invalid question", async () => {
		const { service } = setup()
		const { executor } = fakeExecutor([[{ id: 11, version: 2 }], fieldRows])
		const error = await refusal(
			service.prepare(executor, { ...base, form: { formTemplateId: 11, answers: {} } })
		)
		expect(error.options.data).toEqual({
			scheduleSlotId: 7,
			serviceId: 1,
			fieldErrors: { "100": "This question is required" },
		})
	})

	it("refuses a file key that is not the caller's stored upload", async () => {
		const { service } = setup(false)
		const { executor } = fakeExecutor([[{ id: 11, version: 2 }], fieldRows])
		const error = await refusal(
			service.prepare(executor, {
				...base,
				form: { formTemplateId: 11, answers: { "100": "Ana", "101": KEY } },
			})
		)
		expect(error.options.data.fieldErrors).toEqual({ "101": "Upload this file again" })
	})
})
