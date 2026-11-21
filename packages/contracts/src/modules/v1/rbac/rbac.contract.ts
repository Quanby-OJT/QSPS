import { oc } from "@orpc/contract"
import { z } from "zod"

import {
	AssignRoleRequestSchema,
	AuditLogEntryDetailSchema,
	AuditLogIdParamSchema,
	CreateRoleSchema,
	CreateStaffUserSchema,
	DeleteRoleResponseSchema,
	DeleteUserResponseSchema,
	ExportAuditLogRequestSchema,
	ExportAuditLogResponseSchema,
	ExportUsersRequestSchema,
	ExportUsersResponseSchema,
	ListAuditLogRequestSchema,
	ListAuditLogResponseSchema,
	ListUsersRequestSchema,
	ListUsersResponseSchema,
	PermissionSchema,
	RemoveRoleRequestSchema,
	RoleIdSchema,
	RoleSchema,
	SetRolePermissionsRequestSchema,
	SetUserScopesRequestSchema,
	SetUserStatusRequestSchema,
	UpdateRoleRequestSchema,
	UpdateUserRequestSchema,
	UserIdParamSchema,
	UserRoleMutationResponseSchema,
	UserScopesSchema,
	UserWithRolesSchema,
} from "./rbac.schema.js"

/**
 * RBAC and User Management administration contract.
 */
export const rbacContract = {
	roles: {
		list: oc
			.route({
				method: "GET",
				path: "/rbac/roles",
				summary: "List roles",
				description: "List all roles with their assigned permissions and user counts.",
				tags: ["RBAC"],
			})
			.output(z.array(RoleSchema)),

		create: oc
			.route({
				method: "POST",
				path: "/rbac/roles",
				summary: "Create role",
				description: "Create a new role.",
				tags: ["RBAC"],
			})
			.input(CreateRoleSchema)
			.output(RoleSchema),

		update: oc
			.route({
				method: "PUT",
				path: "/rbac/roles/{id}",
				summary: "Update role",
				description: "Update a role's name or description.",
				tags: ["RBAC"],
			})
			.input(UpdateRoleRequestSchema)
			.output(RoleSchema),

		setPermissions: oc
			.route({
				method: "PUT",
				path: "/rbac/roles/{id}/permissions",
				summary: "Set role permissions",
				description: "Replace the full set of permissions granted to a role.",
				tags: ["RBAC"],
			})
			.input(SetRolePermissionsRequestSchema)
			.output(RoleSchema),

		delete: oc
			.route({
				method: "DELETE",
				path: "/rbac/roles/{id}",
				summary: "Delete role",
				description: "Delete a role.",
				tags: ["RBAC"],
			})
			.input(RoleIdSchema)
			.output(DeleteRoleResponseSchema),
	},

	permissions: {
		list: oc
			.route({
				method: "GET",
				path: "/rbac/permissions",
				summary: "List permissions",
				description: "List the permission catalog.",
				tags: ["RBAC"],
			})
			.output(z.array(PermissionSchema)),
	},

	users: {
		list: oc
			.route({
				method: "GET",
				path: "/rbac/users",
				summary: "List users",
				description: "List users with search, filters, and paging.",
				tags: ["RBAC"],
			})
			.input(ListUsersRequestSchema)
			.output(ListUsersResponseSchema),

		export: oc
			.route({
				method: "GET",
				path: "/rbac/users/export",
				summary: "Export user list",
				description: "Export filtered users to CSV, XLSX, or PDF.",
				tags: ["RBAC"],
			})
			.input(ExportUsersRequestSchema)
			.output(ExportUsersResponseSchema),

		create: oc
			.route({
				method: "POST",
				path: "/rbac/users",
				summary: "Create staff user",
				description: "Create a staff account with assigned roles and trigger an invitation email.",
				tags: ["RBAC"],
			})
			.input(CreateStaffUserSchema)
			.output(UserWithRolesSchema),

		update: oc
			.route({
				method: "PUT",
				path: "/rbac/users/{userId}",
				summary: "Update user",
				description: "Update a user's profile details.",
				tags: ["RBAC"],
			})
			.input(UpdateUserRequestSchema)
			.output(UserWithRolesSchema),

		setStatus: oc
			.route({
				method: "PUT",
				path: "/rbac/users/{userId}/status",
				summary: "Enable or disable user",
				description: "Enable or disable a user account and revoke active sessions when disabled.",
				tags: ["RBAC"],
			})
			.input(SetUserStatusRequestSchema)
			.output(UserWithRolesSchema),

		delete: oc
			.route({
				method: "DELETE",
				path: "/rbac/users/{userId}",
				summary: "Soft-delete user",
				description:
					"Soft-delete a user account, revoking sessions while retaining history and audit entries.",
				tags: ["RBAC"],
			})
			.input(UserIdParamSchema)
			.output(DeleteUserResponseSchema),

		assignRole: oc
			.route({
				method: "POST",
				path: "/rbac/users/{userId}/roles",
				summary: "Assign role to user",
				description: "Assign a role to a user by role name.",
				tags: ["RBAC"],
			})
			.input(AssignRoleRequestSchema)
			.output(UserRoleMutationResponseSchema),

		getScopes: oc
			.route({
				method: "GET",
				path: "/rbac/users/{userId}/scopes",
				summary: "Get user scope",
				description:
					"The Service Categories and Locations a staff user may act on (ADM-2). Needs users.scopes:manage.",
				tags: ["RBAC"],
			})
			.input(UserIdParamSchema)
			.output(UserScopesSchema),

		setScopes: oc
			.route({
				method: "PUT",
				path: "/rbac/users/{userId}/scopes",
				summary: "Set user scope",
				description:
					"Replace a staff user's Service Categories and Locations (ADM-2). Needs users.scopes:manage; a scoped caller may give only scopes inside their own.",
				tags: ["RBAC"],
			})
			.input(SetUserScopesRequestSchema)
			.output(UserScopesSchema),

		removeRole: oc
			.route({
				method: "DELETE",
				path: "/rbac/users/{userId}/roles/{roleName}",
				summary: "Remove role from user",
				description: "Remove a role from a user by role name.",
				tags: ["RBAC"],
			})
			.input(RemoveRoleRequestSchema)
			.output(UserRoleMutationResponseSchema),
	},

	audit: {
		list: oc
			.route({
				method: "GET",
				path: "/rbac/audit-log",
				summary: "List audit log entries",
				description:
					"Audit entries newest first, filtered by date range, actor, role, domain, action, outcome and target, with cursor paging (ADM-3). Needs audit.logs:read.",
				tags: ["RBAC"],
			})
			.input(ListAuditLogRequestSchema)
			.output(ListAuditLogResponseSchema),

		// Declared before `get` so "/export" is never read as an id.
		export: oc
			.route({
				method: "GET",
				path: "/rbac/audit-log/export",
				summary: "Export audit log",
				description:
					"Export the entries matching the filters as CSV or PDF (ADM-3). Needs audit.logs:export. The export is itself audited.",
				tags: ["RBAC"],
			})
			.input(ExportAuditLogRequestSchema)
			.output(ExportAuditLogResponseSchema),

		get: oc
			.route({
				method: "GET",
				path: "/rbac/audit-log/{id}",
				summary: "Get one audit entry",
				description:
					"One entry with its old and new values, IP address, device and hash (ADM-3). Needs audit.logs:read.",
				tags: ["RBAC"],
			})
			.input(AuditLogIdParamSchema)
			.output(AuditLogEntryDetailSchema),
	},
}