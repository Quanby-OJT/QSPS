import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { eq } from "drizzle-orm"

import type { ClientProfile, UpdateClientProfileInput } from "@repo/contracts"
import { users } from "@repo/db/schema"

import { db } from "@/common/database/database.client"

const profileColumns = {
	name: users.name,
	email: users.email,
	mobile: users.mobile,
	birthDate: users.birthDate,
	nationality: users.nationality,
	gender: users.gender,
	profileCompletedAt: users.profileCompletedAt,
}

type ProfileRow = {
	name: string
	email: string
	mobile: string | null
	birthDate: string | null
	nationality: string | null
	gender: string | null
	profileCompletedAt: Date | null
}

function toProfile(row: ProfileRow): ClientProfile {
	return { ...row, isComplete: row.profileCompletedAt !== null }
}

/**
 * The signed-in user's own profile (AUTH-1).
 *
 * `profileCompletedAt` is set the first time every field is saved and never
 * cleared afterwards: it is the gate the web checks before opening the portal.
 */
@Injectable()
export class MeProfileService {
	async getProfile(userId: string): Promise<ClientProfile> {
		const [row] = await db.select(profileColumns).from(users).where(eq(users.id, userId))
		if (!row) throw new ORPCError("NOT_FOUND", { message: "Account not found" })
		return toProfile(row)
	}

	async updateProfile(userId: string, input: UpdateClientProfileInput): Promise<ClientProfile> {
		const [current] = await db
			.select({ profileCompletedAt: users.profileCompletedAt })
			.from(users)
			.where(eq(users.id, userId))
		if (!current) throw new ORPCError("NOT_FOUND", { message: "Account not found" })

		const now = new Date()
		const [row] = await db
			.update(users)
			.set({
				name: input.name,
				mobile: input.mobile,
				birthDate: input.birthDate,
				nationality: input.nationality,
				gender: input.gender,
				updatedAt: now,
				profileCompletedAt: current.profileCompletedAt ?? now,
			})
			.where(eq(users.id, userId))
			.returning(profileColumns)

		if (!row) throw new ORPCError("NOT_FOUND", { message: "Account not found" })
		return toProfile(row)
	}
}
