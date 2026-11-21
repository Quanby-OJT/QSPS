import type { Metadata } from "next"

import { ADMIN_ROLE, type PermissionName } from "@repo/contracts"

import { getAccess } from "@/features/dashboard/server/get-access"
import { AuditLogView } from "@/features/audit-log/components/audit-log-view"

export const metadata: Metadata = {
	title: "Audit log",
}

export default async function AuditLogPage() {
	// ADM-3: the screen opens for anyone signed in. Without audit.logs:read the
	// list request answers 403, RbacGuard audits the denial, and the screen says
	// access is denied. The sidebar shows the link only to holders.
	const access = await getAccess()
	const holds = (key: PermissionName) =>
		(access.roles as readonly string[]).includes(ADMIN_ROLE) ||
		(access.permissions as readonly string[]).includes(key)

	return <AuditLogView canExport={holds("audit.logs:export")} />
}