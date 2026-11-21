"use client"

import { UserMultipleIcon } from "@hugeicons/core-free-icons"

import { PageHeader } from "@/core/components/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/core/components/ui/tabs"
import { RolesPanel } from "@/features/user-management/components/roles-panel"
import { UsersPanel } from "@/features/user-management/components/users-panel"

interface UserManagementViewProps {
	/** users.roles:manage: the Roles tab, and adding or removing a user's roles. */
	canManageRoles: boolean
}

/** The audit log moved to its own page, /audit-log (ADM-3). */
export function UserManagementView({ canManageRoles }: UserManagementViewProps) {
	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				icon={UserMultipleIcon}
				title="User Management"
				description="Manage roles, permissions, and user assignments."
			/>

			<Tabs defaultValue={canManageRoles ? "roles" : "users"}>
				<TabsList>
					{canManageRoles ? <TabsTrigger value="roles">Roles</TabsTrigger> : null}
					<TabsTrigger value="users">Users</TabsTrigger>
				</TabsList>
				{canManageRoles ? (
					<TabsContent value="roles" className="pt-4">
						<RolesPanel />
					</TabsContent>
				) : null}
				<TabsContent value="users" className="pt-4">
					<UsersPanel canManageRoles={canManageRoles} />
				</TabsContent>
			</Tabs>
		</section>
	)
}