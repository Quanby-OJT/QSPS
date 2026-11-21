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
	/** ADM-7: seeded with QSPS. Keeps its name and cannot be deleted. */
	isSystem: z.boolean(),
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

/**
 * One Scope row (ADM-2): a Service Category and a Location the staff user may
 * act on. `null` means "all" on that dimension (DOMAIN-MODEL `user_scopes`).
 */
export const ScopeEntrySchema = z.object({
	serviceCategoryId: z.number().int().positive().nullable(),
	locationId: z.number().int().positive().nullable(),
})

const ScopeListSchema = z.array(ScopeEntrySchema).max(50, "Too many scopes")

export const CreateStaffUserSchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(150, "Name too long"),
	email: z.string().trim().email("Valid email address is required").max(255),
	roles: z.array(z.string().min(1)).min(1, "At least one role is required"),
	/** ADM-2: the new account's Scope. A Module Admin must give at least one, inside their own. */
	scopes: ScopeListSchema.optional(),
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

/** ADM-2: a user's Scope rows. */
export const UserScopesSchema = z.object({
	userId: z.string(),
	scopes: z.array(ScopeEntrySchema),
})

/** ADM-2: replace a user's Scope. userId from the path, scopes from the body. */
export const SetUserScopesRequestSchema = UserIdParamSchema.extend({
	scopes: ScopeListSchema,
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

/** ADM-3: export formats for the audit log. */
export const AuditExportFormatSchema = z.enum(["csv", "pdf"])

/** One Audit Entry as listed (DOMAIN-MODEL `audit_log`). */
export const AuditLogEntrySchema = z.object({
	id: z.number().int(),
	domain: z.string(),
	action: z.string(),
	outcome: AuditOutcomeSchema,
	actorId: z.string().nullable(),
	actorEmail: z.string().nullable(),
	/** The actor's role names when they acted. Null for System. */
	actorRole: z.string().nullable(),
	targetType: z.string().nullable(),
	targetId: z.string().nullable(),
	oldValue: z.unknown().nullable(),
	newValue: z.unknown().nullable(),
	reason: z.string().nullable(),
	/** Null for System actions. */
	ipAddress: z.string().nullable(),
	/** The device (User-Agent). Null for System actions. */
	userAgent: z.string().nullable(),
	createdAt: z.date(),
})

/** ADM-3: one entry opened, with its place in the hash chain. */
export const AuditLogEntryDetailSchema = AuditLogEntrySchema.extend({
	prevHash: z.string().nullable(),
	entryHash: z.string().nullable(),
})

/** A business date, YYYY-MM-DD, read in Asia/Manila. */
const AuditDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional()

/**
 * ADM-3: the audit log filters. Every one is optional and they combine with AND.
 * `from` and `to` are Manila dates, both included.
 */
export const AuditLogFilterSchema = z.object({
	from: AuditDateSchema.optional(),
	to: AuditDateSchema.optional(),
	/** An email (or part of one), a user id, or "system" for System actions. */
	actor: optionalText(255),
	/** A role name, matched against the role the actor held at the time. */
	role: optionalText(100),
	domain: optionalText(100),
	/** Matches from the start, so "role." finds every role action. */
	action: optionalText(100),
	outcome: AuditOutcomeSchema.optional(),
	targetType: optionalText(100),
	targetId: optionalText(255),
})

export const ListAuditLogRequestSchema = AuditLogFilterSchema.extend({
	limit: z.coerce.number().int().min(1).max(200).optional().default(50),
	before: z.coerce.number().int().positive().optional(),
})

export const ListAuditLogResponseSchema = z.object({
	entries: z.array(AuditLogEntrySchema),
	nextCursor: z.number().int().nullable(),
})

export const AuditLogIdParamSchema = z.object({
	id: z.coerce.number().int().positive(),
})

export const ExportAuditLogRequestSchema = AuditLogFilterSchema.extend({
	format: AuditExportFormatSchema,
})

export const ExportAuditLogResponseSchema = z.object({
	fileName: z.string(),
	mimeType: z.string(),
	contentBase64: z.string(),
	rowCount: z.number().int().nonnegative(),
	/** True when more entries matched than one export holds. */
	truncated: z.boolean(),
})

// ============================================================================
// TYPES
// ============================================================================
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>
export type ListAuditLogRequest = z.infer<typeof ListAuditLogRequestSchema>
export type ListAuditLogResponse = z.infer<typeof ListAuditLogResponseSchema>
export type AuditLogEntryDetail = z.infer<typeof AuditLogEntryDetailSchema>
export type AuditLogFilter = z.infer<typeof AuditLogFilterSchema>
export type AuditExportFormat = z.infer<typeof AuditExportFormatSchema>
export type ExportAuditLogRequest = z.infer<typeof ExportAuditLogRequestSchema>
export type ExportAuditLogResponse = z.infer<typeof ExportAuditLogResponseSchema>
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
export type ScopeEntryInput = z.infer<typeof ScopeEntrySchema>
export type UserScopes = z.infer<typeof UserScopesSchema>
export type SetUserScopesRequest = z.infer<typeof SetUserScopesRequestSchema>
export type DeleteUserResponse = z.infer<typeof DeleteUserResponseSchema>
export type AssignRoleRequest = z.infer<typeof AssignRoleRequestSchema>
export type RemoveRoleRequest = z.infer<typeof RemoveRoleRequestSchema>