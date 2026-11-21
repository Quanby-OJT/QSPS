"use client"

import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import type { Location, ScopeEntryInput, ServiceCategory } from "@repo/contracts"

import { Button } from "@/core/components/ui/button"
import { FieldDescription } from "@/core/components/ui/field"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/core/components/ui/select"

const ALL = "__all__"

interface ScopeEditorProps {
	value: ScopeEntryInput[]
	onChange: (next: ScopeEntryInput[]) => void
	categories: ServiceCategory[]
	locations: Location[]
	disabled?: boolean
}

function toValue(id: number | null): string {
	return id === null ? ALL : String(id)
}

function toId(value: unknown): number | null {
	return typeof value === "string" && value !== ALL ? Number(value) : null
}

/**
 * ADM-2: the Service Categories and Locations a staff user may act on. Each
 * row is one `user_scopes` row; "All" stores null. A scoped admin's own
 * lists only show what is inside their Scope.
 */
export function ScopeEditor({
	value,
	onChange,
	categories,
	locations,
	disabled,
}: ScopeEditorProps) {
	const categoryItems = {
		[ALL]: "All service categories",
		...Object.fromEntries(categories.map(category => [String(category.id), category.name])),
	}
	const locationItems = {
		[ALL]: "All locations",
		...Object.fromEntries(locations.map(location => [String(location.id), location.name])),
	}

	function update(index: number, patch: Partial<ScopeEntryInput>) {
		onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
	}

	return (
		<div className="flex flex-col gap-2">
			{value.length === 0 ? (
				<p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
					No scope yet. Scoped roles see nothing until one is added.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{value.map((row, index) => (
						<li
							key={`${toValue(row.serviceCategoryId)}-${toValue(row.locationId)}-${index}`}
							className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center"
						>
							<Select
								items={categoryItems}
								value={toValue(row.serviceCategoryId)}
								onValueChange={next => update(index, { serviceCategoryId: toId(next) })}
								disabled={disabled}
							>
								<SelectTrigger
									className="w-full"
									aria-label={`Service category for scope ${index + 1}`}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL}>All service categories</SelectItem>
									{categories.map(category => (
										<SelectItem key={category.id} value={String(category.id)}>
											{category.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>

							<Select
								items={locationItems}
								value={toValue(row.locationId)}
								onValueChange={next => update(index, { locationId: toId(next) })}
								disabled={disabled}
							>
								<SelectTrigger className="w-full" aria-label={`Location for scope ${index + 1}`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL}>All locations</SelectItem>
									{locations.map(location => (
										<SelectItem key={location.id} value={String(location.id)}>
											{location.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>

							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="justify-self-end"
								onClick={() => onChange(value.filter((_, i) => i !== index))}
								disabled={disabled}
								aria-label={`Remove scope ${index + 1}`}
							>
								<HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
							</Button>
						</li>
					))}
				</ul>
			)}

			<Button
				type="button"
				variant="outline"
				size="sm"
				className="self-start"
				onClick={() => onChange([...value, { serviceCategoryId: null, locationId: null }])}
				disabled={disabled}
			>
				<HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
				Add scope
			</Button>
			<FieldDescription>
				Super Admin, System Admin and Auditor work nationwide and ignore scope.
			</FieldDescription>
		</div>
	)
}
