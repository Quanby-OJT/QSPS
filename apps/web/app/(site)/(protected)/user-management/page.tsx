import type { Metadata } from "next"

import { ADMIN_ROLE, type PermissionName } from "@repo/contracts"

import { getAccess } from "@/features/dashboard/server/get-access"
import { UserManagementView } from "@/features/user-management/components/user-management-view"

export const metadata: Metadata = {
	title: "User Management",
}

export default async function UserManagementPage() {
	// ADM-2: show only the tabs the caller may use. A Module Admin lacks
	// users.roles:manage; asking anyway only produced 403s and a denied audit
	// entry on every visit. The audit log has its own page since ADM-3.
	const access = await getAccess()
	const holds = (key: PermissionName) =>
		(access.roles as readonly string[]).includes(ADMIN_ROLE) ||
		(access.permissions as readonly string[]).includes(key)

	return <UserManagementView canManageRoles={holds("users.roles:manage")} />
}