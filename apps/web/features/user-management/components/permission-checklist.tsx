"use client"

import { useMemo } from "react"

import type { PermissionCatalogEntry, PermissionName } from "@repo/contracts"

import { Button } from "@/core/components/ui/button"
import { Checkbox } from "@/core/components/ui/checkbox"
import { Field, FieldLabel } from "@/core/components/ui/field"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import { usePermissionsQuery } from "@/features/user-management/api/rbac.hooks"

interface PermissionChecklistProps {
	value: PermissionName[]
	onChange: (next: PermissionName[]) => void
	disabled?: boolean
}

/** Headings for the catalog's modules (the text before the first dot). */
const MODULE_LABELS: Record<string, string> = {
	account: "Account",
	users: "Users",
	audit: "Audit",
	settings: "Settings",
	schedules: "Schedules",
	forms: "Forms",
	bookings: "Bookings",
	payments: "Payments",
	processing: "Processing",
	certificates: "Certificates",
	reports: "Reports",
	migration: "Migration",
}

function titleCase(text: string): string {
	return text
		.split(/[-_]/)
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")
}

interface ModuleGroup {
	module: string
	submodules: { submodule: string; entries: PermissionCatalogEntry[] }[]
	keys: PermissionName[]
}

/**
 * `module.submodule:action` → module, then submodule, in catalog order
 * (ADM-7: "permissions grouped by module and submodule").
 */
function groupCatalog(catalog: PermissionCatalogEntry[]): ModuleGroup[] {
	const modules = new Map<string, ModuleGroup>()
	for (const entry of catalog) {
		const [resource = entry.name] = entry.name.split(":")
		const [module = resource, submodule = resource] = resource.split(".")
		const group = modules.get(module) ?? { module, submodules: [], keys: [] }
		let sub = group.submodules.find(item => item.submodule === submodule)
		if (!sub) {
			sub = { submodule, entries: [] }
			group.submodules.push(sub)
		}
		sub.entries.push(entry)
		group.keys.push(entry.name)
		modules.set(module, group)
	}
	return Array.from(modules.values())
}

export function PermissionChecklist({ value, onChange, disabled }: PermissionChecklistProps) {
	const permissionsQuery = usePermissionsQuery()
	const { data: permissions, isError, error } = permissionsQuery

	// During the persisted-cache restore a pending query reports
	// `isLoading === false`; without this the checklist flashes "no permissions"
	// before the snapshot lands. See `useIsQueryLoading`.
	const isQueryLoading = useIsQueryLoading()

	const groups = useMemo(() => groupCatalog(permissions ?? []), [permissions])
	const selected = useMemo(() => new Set(value), [value])

	function toggle(permission: PermissionName, checked: boolean) {
		onChange(checked ? [...value, permission] : value.filter(p => p !== permission))
	}

	function setModule(keys: PermissionName[], checked: boolean) {
		const inModule = new Set(keys)
		const others = value.filter(p => !inModule.has(p))
		onChange(checked ? [...others, ...keys] : others)
	}

	if (isQueryLoading(permissionsQuery)) {
		return <p className="text-muted-foreground text-sm">Loading permissions...</p>
	}

	if (isError) {
		return (
			<p className="text-destructive text-sm">
				{error instanceof Error ? error.message : "Failed to load permissions"}
			</p>
		)
	}

	return (
		<div className="flex flex-col gap-3">
			<p className="text-muted-foreground text-xs">
				{value.length} of {permissions?.length ?? 0} permissions selected
			</p>
			{groups.map(group => {
				const chosen = group.keys.filter(key => selected.has(key)).length
				const allChosen = chosen === group.keys.length
				return (
					<fieldset key={group.module} className="rounded-lg border">
						<div className="bg-muted/50 flex items-center justify-between gap-2 rounded-t-lg border-b px-3 py-2">
							<legend className="text-sm font-semibold">
								{MODULE_LABELS[group.module] ?? titleCase(group.module)}
								<span className="text-muted-foreground ml-2 text-xs font-normal">
									{chosen}/{group.keys.length}
								</span>
							</legend>
							<Button
								type="button"
								variant="link"
								size="sm"
								className="h-auto px-0 text-xs"
								onClick={() => setModule(group.keys, !allChosen)}
								disabled={disabled}
							>
								{allChosen ? "Clear" : "Select all"}
							</Button>
						</div>
						<div className="flex flex-col gap-3 p-3">
							{group.submodules.map(sub => (
								<div key={sub.submodule} className="flex flex-col gap-1.5">
									<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
										{titleCase(sub.submodule)}
									</p>
									<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
										{sub.entries.map(entry => (
											<Field key={entry.name} orientation="horizontal" className="items-start">
												<Checkbox
													id={`perm-${entry.name}`}
													checked={selected.has(entry.name)}
													onCheckedChange={checked => toggle(entry.name, checked === true)}
													disabled={disabled}
												/>
												<FieldLabel
													htmlFor={`perm-${entry.name}`}
													className="flex flex-col items-start gap-0 font-normal"
												>
													<span>{entry.description ?? entry.name}</span>
													<code className="text-muted-foreground text-[11px]">{entry.name}</code>
												</FieldLabel>
											</Field>
										))}
									</div>
								</div>
							))}
						</div>
					</fieldset>
				)
			})}
		</div>
	)
}
