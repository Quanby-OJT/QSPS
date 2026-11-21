import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { eq } from "drizzle-orm"

import type { CreateLocationInput, Location, UpdateLocationRequest } from "@repo/contracts"
import { locations } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { denyOutsideScope } from "@/common/scope/scope-denial"
import {
	coversAll,
	inScope,
	NATIONWIDE_SCOPE,
	scopeCondition,
	type ResolvedScope,
} from "@/common/scope/scope-match"

const AUDIT_DOMAIN_LOCATIONS = "locations"

@Injectable()
export class LocationsService {
	constructor(private readonly auditService: AuditService) {}

	/** Staff list. ADM-2: limited to the Locations in the caller's Scope. */
	async list(scope: ResolvedScope = NATIONWIDE_SCOPE): Promise<Location[]> {
		return db
			.select()
			.from(locations)
			.where(scopeCondition(scope, { locationId: locations.id }))
			.orderBy(locations.name)
	}

	async listAvailable(): Promise<Location[]> {
		return db.select().from(locations).where(eq(locations.isActive, true)).orderBy(locations.name)
	}

	async create(
		input: CreateLocationInput,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<Location> {
		// ADM-2: a new Location is in nobody's Scope yet, so only a user whose
		// Scope reaches every Location may add one.
		if (!coversAll(scope, "locationId")) {
			await this.auditService.record({
				domain: AUDIT_DOMAIN_LOCATIONS,
				action: "location.create",
				outcome: "denied",
				actorId,
				targetType: "location",
				targetId: input.code,
				newValue: { code: input.code },
				reason: "outside scope",
			})
			throw new ORPCError("FORBIDDEN", {
				message: "Only an administrator for all locations can add a location",
			})
		}

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

	async update(
		input: UpdateLocationRequest,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<Location> {
		return db.transaction(async tx => {
			const [current] = await tx.select().from(locations).where(eq(locations.code, input.code))
			if (!current) {
				throw new ORPCError("NOT_FOUND", { message: `Location "${input.code}" was not found` })
			}
			await this.requireInScope(current, actorId, scope)

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
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<Location> {
		return db.transaction(async tx => {
			const [current] = await tx.select().from(locations).where(eq(locations.code, input.code))
			if (!current) {
				throw new ORPCError("NOT_FOUND", { message: `Location "${input.code}" was not found` })
			}
			await this.requireInScope(current, actorId, scope)

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

	async delete(
		code: string,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<never> {
		const [location] = await db.select().from(locations).where(eq(locations.code, code))
		if (!location) {
			throw new ORPCError("NOT_FOUND", { message: `Location "${code}" was not found` })
		}
		await this.requireInScope(location, actorId, scope)

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

	/** ADM-2: a Location outside the caller's Scope answers like a missing one. */
	private async requireInScope(
		location: Location,
		actorId: string | null,
		scope: ResolvedScope
	): Promise<void> {
		if (inScope(scope, { locationId: location.id })) return
		await denyOutsideScope(this.auditService, actorId, {
			type: "location",
			id: location.code,
			notFoundMessage: `Location "${location.code}" was not found`,
		})
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
