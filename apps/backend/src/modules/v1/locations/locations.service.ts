import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { eq } from "drizzle-orm"

import type { CreateLocationInput, Location, UpdateLocationRequest } from "@repo/contracts"
import { locations } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

const AUDIT_DOMAIN_LOCATIONS = "locations"

@Injectable()
export class LocationsService {
	constructor(private readonly auditService: AuditService) {}

	async list(): Promise<Location[]> {
		return db.select().from(locations).orderBy(locations.name)
	}

	async listAvailable(): Promise<Location[]> {
		return db.select().from(locations).where(eq(locations.isActive, true)).orderBy(locations.name)
	}

	async create(input: CreateLocationInput, actorId: string | null): Promise<Location> {
		return db.transaction(async tx => {
			const [location] = await tx
				.insert(locations)
				.values({
					...input,
					isActive: true,
				})
				.onConflictDoNothing({ target: locations.code })
				.returning()

			if (!location) {
				throw new ORPCError("CONFLICT", {
					message: `Location code "${input.code}" is already in use`,
				})
			}

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_LOCATIONS,
					action: "location.create",
					actorId,
					targetType: "location",
					targetId: location.code,
					oldValue: null,
					newValue: this.auditValue(location),
				},
				tx
			)

			return location
		})
	}

	async update(input: UpdateLocationRequest, actorId: string | null): Promise<Location> {
		return db.transaction(async tx => {
			const [current] = await tx.select().from(locations).where(eq(locations.code, input.code))
			if (!current) {
				throw new ORPCError("NOT_FOUND", { message: `Location "${input.code}" was not found` })
			}

			const next = {
				name: input.name ?? current.name,
				address: input.address ?? current.address,
				region: input.region ?? current.region,
			}

			const [updated] = await tx
				.update(locations)
				.set({ ...next, updatedAt: new Date() })
				.where(eq(locations.code, current.code))
				.returning()
			if (!updated) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Location could not be updated",
				})
			}

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_LOCATIONS,
					action: "location.update",
					actorId,
					targetType: "location",
					targetId: current.code,
					oldValue: this.auditValue(current),
					newValue: this.auditValue(updated),
				},
				tx
			)

			return updated
		})
	}

	async setActive(
		input: { code: string; isActive: boolean },
		actorId: string | null
	): Promise<Location> {
		return db.transaction(async tx => {
			const [current] = await tx.select().from(locations).where(eq(locations.code, input.code))
			if (!current) {
				throw new ORPCError("NOT_FOUND", { message: `Location "${input.code}" was not found` })
			}

			const [updated] = await tx
				.update(locations)
				.set({ isActive: input.isActive, updatedAt: new Date() })
				.where(eq(locations.code, current.code))
				.returning()
			if (!updated) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Location status could not be updated",
				})
			}

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_LOCATIONS,
					action: input.isActive ? "location.enable" : "location.disable",
					actorId,
					targetType: "location",
					targetId: current.code,
					oldValue: this.auditValue(current),
					newValue: this.auditValue(updated),
				},
				tx
			)

			return updated
		})
	}

	async delete(code: string, actorId: string | null): Promise<never> {
		const [location] = await db.select().from(locations).where(eq(locations.code, code))
		if (!location) {
			throw new ORPCError("NOT_FOUND", { message: `Location "${code}" was not found` })
		}

		const reason =
			"Locations cannot be safely deleted because booking references cannot yet be checked. Disable the location instead."
		await this.auditService.record({
			domain: AUDIT_DOMAIN_LOCATIONS,
			action: "location.delete",
			outcome: "denied",
			actorId,
			targetType: "location",
			targetId: code,
			oldValue: this.auditValue(location),
			newValue: null,
			reason,
		})
		throw new ORPCError("CONFLICT", { message: reason })
	}

	private auditValue(location: Location) {
		return {
			code: location.code,
			name: location.name,
			address: location.address,
			region: location.region,
			isActive: location.isActive,
		}
	}
}
