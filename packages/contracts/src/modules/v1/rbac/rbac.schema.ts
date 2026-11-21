import { z } from "zod"

import { PermissionNameSchema } from "./rbac.catalog.js"

// ============================================================================
// SHARED
// ============================================================================
const dateField = z
	.union([z.date(), z.string()])
	.transform(val => (typeof val === "string" ? new Date(val) : val))

const nullableDateField = z
	.union([z.date(), z.string(), z.null()])
	.transform(val => (val === null ? null : typeof val === "string" ? new Date(val) : val))

const RoleIdParamSchema = z.object({
	id: z.coerce.number().int().positive(),
})

// ============================================================================
// ROLES
// ============================================================================
export const RoleSchema = z.object({
	id: z.number().int().positive(),
	name: z.string().min(1),
	description: z.string().nullable(),
	permissions: z.array(PermissionNameSchema),
	userCount: z.number().int().nonnegative(),
	createdAt: dateField,
	updatedAt: dateField,
})

export const CreateRoleSchema = z.object({
	name: z.string().min(1, "Name is required").max(100, "Name too long"),
	description: z.string().max(255, "Description too long").optional(),
})

/** Update route input: id from path + optional name/description */
export const UpdateRoleRequestSchema = RoleIdParamSchema.extend({
	name: z.string().min(1, "Name is required").max(100, "Name too long").optional(),
	description: z.string().max(255, "Description too long").nullable().optional(),
})

/** Set-permissions route input: id from path + full permission list */
export const SetRolePermissionsRequestSchema = RoleIdParamSchema.extend({
	permissions: z.array(PermissionNameSchema),
})

export const RoleIdSchema = RoleIdParamSchema

export const DeleteRoleResponseSchema = z.object({
	success: z.boolean(),
	id: z.number().int().positive(),
})

// ============================================================================
// PERMISSIONS (read-only catalog)
// ============================================================================
export const PermissionSchema = z.object({
	name: PermissionNameSchema,
	description: z.string().nullable(),
})

// ============================================================================
// USERS
// ============================================================================
export const UserAccountTypeSchema = z.enum(["client", "staff"])
export const UserAccountStatusSchema = z.enum(["active", "disabled", "deleted"])
export const UserExportFormatSchema = z.enum(["csv", "xlsx", "pdf"])

export const UserWithRolesSchema = z.object({
	id: z.string(),
	name: z.string().nullable(),
	email: z.string(),
	accountType: UserAccountTypeSchema,
	status: UserAccountStatusSchema,
	roles: z.array(z.string()),
	disabledAt: nullableDateField,
	deletedAt: nullableDateField,
	createdAt: dateField,
})

export const UserFilterQuerySchema = z.object({
	search: z.string().trim().max(150).optional(),
	role: z.string().trim().min(1).max(100).optional(),
	status: UserAccountStatusSchema.optional(),
	accountType: UserAccountTypeSchema.optional(),
})

export const ListUsersRequestSchema = UserFilterQuerySchema.extend({
	page: z.coerce.number().int().min(1).optional().default(1),
	pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
})

export const ListUsersResponseSchema = z.object({
	items: z.array(UserWithRolesSchema),
	total: z.number().int().nonnegative(),
	page: z.number().int().min(1),
	pageSize: z.number().int().min(1),
	totalPages: z.number().int().nonnegative(),
})

export const ExportUsersRequestSchema = UserFilterQuerySchema.extend({
	format: UserExportFormatSchema,
})

export const ExportUsersResponseSchema = z.object({
	fileName: z.string(),
	mimeType: z.string(),
	contentBase64: z.string(),
})

export const CreateStaffUserSchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(150, "Name too long"),
	email: z.string().trim().email("Valid email address is required").max(255),
	roles: z.array(z.string().min(1)).min(1, "At least one role is required"),
})

export const UserIdParamSchema = z.object({
	userId: z.string().min(1),
})

export const UpdateUserRequestSchema = UserIdParamSchema.extend({
	name: z.string().trim().min(1, "Name is required").max(150, "Name too long").optional(),
	email: z.string().trim().email("Valid email address is required").max(255).optional(),
}).refine(({ name, email }) => name !== undefined || email !== undefined, {
	message: "At least one field must be provided",
})

export const SetUserStatusRequestSchema = UserIdParamSchema.extend({
	isActive: z.boolean(),
})

export const DeleteUserResponseSchema = z.object({
	success: z.boolean(),
	userId: z.string(),
})

/** Assign route input: userId from path + roleName from body */
export const AssignRoleRequestSchema = z.object({
	userId: z.string().min(1),
	roleName: z.string().min(1),
})

/** Remove route input: userId + roleName, both from path */
export const RemoveRoleRequestSchema = z.object({
	userId: z.string().min(1),
	roleName: z.string().min(1),
})

export const UserRoleMutationResponseSchema = z.object({
	success: z.boolean(),
	userId: z.string(),
	roleName: z.string(),
})

// ============================================================================
// AUDIT LOG
// ============================================================================

export const AuditOutcomeSchema = z.enum(["success", "denied"])

export const AuditLogEntrySchema = z.object({
	id: z.number().int(),
	domain: z.string(),
	action: z.string(),
	outcome: AuditOutcomeSchema,
	actorId: z.string().nullable(),
	actorEmail: z.string().nullable(),
	targetType: z.string().nullable(),
	targetId: z.string().nullable(),
	oldValue: z.unknown().nullable(),
	newValue: z.unknown().nullable(),
	reason: z.string().nullable(),
	createdAt: z.date(),
})

export const ListAuditLogRequestSchema = z.object({
	limit: z.coerce.number().int().min(1).max(200).optional().default(50),
	before: z.coerce.number().int().positive().optional(),
})

export const ListAuditLogResponseSchema = z.object({
	entries: z.array(AuditLogEntrySchema),
	nextCursor: z.number().int().nullable(),
})

// ============================================================================
// TYPES
// ============================================================================
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>
export type ListAuditLogRequest = z.infer<typeof ListAuditLogRequestSchema>
export type ListAuditLogResponse = z.infer<typeof ListAuditLogResponseSchema>
export type Role = z.infer<typeof RoleSchema>
export type CreateRoleInput = z.infer<typeof CreateRoleSchema>
export type UpdateRoleRequest = z.infer<typeof UpdateRoleRequestSchema>
export type SetRolePermissionsRequest = z.infer<typeof SetRolePermissionsRequestSchema>
export type PermissionCatalogEntry = z.infer<typeof PermissionSchema>
export type UserAccountType = z.infer<typeof UserAccountTypeSchema>
export type UserAccountStatus = z.infer<typeof UserAccountStatusSchema>
export type UserExportFormat = z.infer<typeof UserExportFormatSchema>
export type UserWithRoles = z.infer<typeof UserWithRolesSchema>
export type ListUsersRequest = z.infer<typeof ListUsersRequestSchema>
export type ListUsersResponse = z.infer<typeof ListUsersResponseSchema>
export type ExportUsersRequest = z.infer<typeof ExportUsersRequestSchema>
export type ExportUsersResponse = z.infer<typeof ExportUsersResponseSchema>
export type CreateStaffUserInput = z.infer<typeof CreateStaffUserSchema>
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>
export type SetUserStatusRequest = z.infer<typeof SetUserStatusRequestSchema>
export type DeleteUserResponse = z.infer<typeof DeleteUserResponseSchema>
export type AssignRoleRequest = z.infer<typeof AssignRoleRequestSchema>
export type RemoveRoleRequest = z.infer<typeof RemoveRoleRequestSchema>
