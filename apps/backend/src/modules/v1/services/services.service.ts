import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, eq, ne } from "drizzle-orm"

import type {
	CreateServiceInput,
	Service,
	ServiceCategory,
	UpdateServiceRequest,
} from "@repo/contracts"
import { serviceCategories, services } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

const AUDIT_DOMAIN_SERVICES = "services"

type ServiceRow = typeof services.$inferSelect
type CategoryRow = typeof serviceCategories.$inferSelect

function serviceResponse(service: ServiceRow, category: CategoryRow): Service {
	return {
		id: service.id,
		serviceCategoryId: service.serviceCategoryId,
		categoryCode: category.code,
		categoryName: category.name,
		name: service.name,
		feeCentavos: service.feeCentavos,
		requiresHeadApproval: service.requiresHeadApproval,
		isActive: service.isActive,
		createdAt: service.createdAt,
		updatedAt: service.updatedAt,
	}
}

@Injectable()
export class ServicesService {
	constructor(private readonly auditService: AuditService) {}

	async listCategories(): Promise<ServiceCategory[]> {
		return db.select().from(serviceCategories).orderBy(asc(serviceCategories.name))
	}

	async list(): Promise<Service[]> {
		const rows = await db
			.select({
				service: services,
				category: serviceCategories,
			})
			.from(services)
			.innerJoin(serviceCategories, eq(services.serviceCategoryId, serviceCategories.id))
			.orderBy(asc(serviceCategories.name), asc(services.name))

		return rows.map(({ service, category }) => serviceResponse(service, category))
	}

	async listAvailable(): Promise<Service[]> {
		const rows = await db
			.select({
				service: services,
				category: serviceCategories,
			})
			.from(services)
			.innerJoin(serviceCategories, eq(services.serviceCategoryId, serviceCategories.id))
			.where(eq(services.isActive, true))
			.orderBy(asc(serviceCategories.name), asc(services.name))

		return rows.map(({ service, category }) => serviceResponse(service, category))
	}

	async create(input: CreateServiceInput, actorId: string | null): Promise<Service> {
		return db.transaction(async tx => {
			const [category] = await tx
				.select()
				.from(serviceCategories)
				.where(eq(serviceCategories.id, input.serviceCategoryId))
			if (!category) {
				throw new ORPCError("NOT_FOUND", {
					message: `Service category "${input.serviceCategoryId}" was not found`,
				})
			}

			const [service] = await tx
				.insert(services)
				.values({
					serviceCategoryId: input.serviceCategoryId,
					name: input.name,
					feeCentavos: input.feeCentavos,
					requiresHeadApproval: input.requiresHeadApproval,
					isActive: true,
				})
				.onConflictDoNothing({
					target: [services.serviceCategoryId, services.name],
				})
				.returning()
			if (!service) {
				throw new ORPCError("CONFLICT", {
					message: `A service named "${input.name}" already exists in this category`,
				})
			}

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_SERVICES,
					action: "service.create",
					actorId,
					targetType: "service",
					targetId: String(service.id),
					oldValue: null,
					newValue: this.auditValue(service),
				},
				tx
			)

			return serviceResponse(service, category)
		})
	}

	async update(input: UpdateServiceRequest, actorId: string | null): Promise<Service> {
		return db.transaction(async tx => {
			const [current] = await tx.select().from(services).where(eq(services.id, input.id))
			if (!current) {
				throw new ORPCError("NOT_FOUND", { message: `Service "${input.id}" was not found` })
			}

			const serviceCategoryId = input.serviceCategoryId ?? current.serviceCategoryId
			const [category] = await tx
				.select()
				.from(serviceCategories)
				.where(eq(serviceCategories.id, serviceCategoryId))
			if (!category) {
				throw new ORPCError("NOT_FOUND", {
					message: `Service category "${serviceCategoryId}" was not found`,
				})
			}

			const [duplicate] = await tx
				.select({ id: services.id })
				.from(services)
				.where(
					and(
						eq(services.serviceCategoryId, serviceCategoryId),
						eq(services.name, input.name ?? current.name),
						ne(services.id, current.id)
					)
				)
				.limit(1)
			if (duplicate) {
				throw new ORPCError("CONFLICT", {
					message: `A service named "${input.name ?? current.name}" already exists in this category`,
				})
			}

			const [updated] = await tx
				.update(services)
				.set({
					serviceCategoryId,
					name: input.name ?? current.name,
					feeCentavos: input.feeCentavos ?? current.feeCentavos,
					requiresHeadApproval: input.requiresHeadApproval ?? current.requiresHeadApproval,
					updatedAt: new Date(),
				})
				.where(eq(services.id, current.id))
				.returning()
			if (!updated) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Service could not be updated" })
			}

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_SERVICES,
					action:
						updated.feeCentavos !== current.feeCentavos ? "service.fee.update" : "service.update",
					actorId,
					targetType: "service",
					targetId: String(current.id),
					oldValue: this.auditValue(current),
					newValue: this.auditValue(updated),
				},
				tx
			)

			return serviceResponse(updated, category)
		})
	}

	async setActive(
		input: { id: number; isActive: boolean },
		actorId: string | null
	): Promise<Service> {
		return db.transaction(async tx => {
			const [current] = await tx.select().from(services).where(eq(services.id, input.id))
			if (!current) {
				throw new ORPCError("NOT_FOUND", { message: `Service "${input.id}" was not found` })
			}

			const [category] = await tx
				.select()
				.from(serviceCategories)
				.where(eq(serviceCategories.id, current.serviceCategoryId))
			if (!category) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Service category could not be loaded",
				})
			}

			const [updated] = await tx
				.update(services)
				.set({ isActive: input.isActive, updatedAt: new Date() })
				.where(eq(services.id, current.id))
				.returning()
			if (!updated) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Service status could not be updated",
				})
			}

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_SERVICES,
					action: input.isActive ? "service.enable" : "service.disable",
					actorId,
					targetType: "service",
					targetId: String(current.id),
					oldValue: this.auditValue(current),
					newValue: this.auditValue(updated),
				},
				tx
			)

			return serviceResponse(updated, category)
		})
	}

	private auditValue(service: ServiceRow) {
		return {
			id: service.id,
			serviceCategoryId: service.serviceCategoryId,
			name: service.name,
			feeCentavos: service.feeCentavos,
			requiresHeadApproval: service.requiresHeadApproval,
			isActive: service.isActive,
		}
	}
}
