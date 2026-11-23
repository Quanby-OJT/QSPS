"use client"

import { useState } from "react"
import { Download01Icon, ShieldKeyIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "sonner"

import type { AuditExportFormat, AuditLogEntry, AuditLogFilter } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/core/components/ui/empty"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/core/components/ui/select"
import { Skeleton } from "@/core/components/ui/skeleton"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/core/components/ui/table"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { ApiError } from "@/core/lib/api-error"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import {
	useAuditLogQuery,
	useExportAuditLogMutation,
} from "@/features/audit-log/api/audit-log.hooks"
import { AuditEntryDialog } from "@/features/audit-log/components/audit-entry-dialog"
import {
	actorLabel,
	draftToFilter,
	EMPTY_AUDIT_DRAFT,
	formatAuditTime,
	rangeIsBackwards,
	targetLabel,
	type AuditFilterDraft,
} from "@/features/audit-log/lib/filters"

/** Passed to `Select` as `items` so the trigger shows the label, not the value. */
const OUTCOME_ITEMS = {
	all: "Any outcome",
	success: "Success",
	denied: "Denied",
} as const

interface AuditLogViewProps {
	/** audit.logs:export, decided on the server. */
	canExport: boolean
}

/**
 * ADM-3: search, filter and export the audit trail (TOR §VIII.1).
 *
 * Read-only by design. Entries cannot be edited or removed, so the screen
 * offers no way to do either.
 *
 * Hydration-safe: the server and the client's first render both show the
 * loading rows, even when the client already holds a restored copy of the log.
 */
export function AuditLogView({ canExport }: AuditLogViewProps) {
	const [draft, setDraft] = useState<AuditFilterDraft>(EMPTY_AUDIT_DRAFT)
	const [filter, setFilter] = useState<AuditLogFilter>({})
	const [formError, setFormError] = useState<string | null>(null)
	const [openEntry, setOpenEntry] = useState<AuditLogEntry | null>(null)

	const query = useAuditLogQuery(filter)
	const exportLog = useExportAuditLogMutation()
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()

	const loading = !hydrated || isQueryLoading(query)
	const entries = loading ? [] : (query.data?.pages.flatMap(page => page.entries) ?? [])
	const forbidden = !loading && query.error instanceof ApiError && query.error.status === 403

	function setField<K extends keyof AuditFilterDraft>(key: K, value: AuditFilterDraft[K]) {
		setDraft(current => ({ ...current, [key]: value }))
	}

	function applyFilters(event: React.FormEvent) {
		event.preventDefault()
		const next = draftToFilter(draft)
		if (rangeIsBackwards(next)) {
			setFormError("The start date must be on or before the end date.")
			return
		}
		setFormError(null)
		setFilter(next)
	}

	function clearFilters() {
		setDraft(EMPTY_AUDIT_DRAFT)
		setFilter({})
		setFormError(null)
	}

	async function runExport(format: AuditExportFormat) {
		try {
			const result = await exportLog.mutateAsync({ ...filter, format })
			if (result.truncated) {
				toast.warning(
					`Exported the newest ${result.rowCount.toLocaleString()} entries. Narrow the filters to export the rest.`
				)
			} else {
				toast.success(`Exported ${result.rowCount.toLocaleString()} entries`)
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not export the audit log")
		}
	}

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				icon={ShieldKeyIcon}
				title="Audit log"
				description="Every recorded action, newest first. Entries cannot be edited or removed."
				actions={
					canExport && !forbidden ? (
						<>
							<Button
								variant="outline"
								size="sm"
								onClick={() => void runExport("csv")}
								disabled={exportLog.isPending}
							>
								<HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
								CSV
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={() => void runExport("pdf")}
								disabled={exportLog.isPending}
							>
								<HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
								PDF
							</Button>
						</>
					) : null
				}
			/>

			{forbidden ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<HugeiconsIcon icon={ShieldKeyIcon} strokeWidth={2} />
						</EmptyMedia>
						<EmptyTitle>You do not have access to the audit log</EmptyTitle>
						<EmptyDescription>
							Reading the audit log needs the audit.logs:read permission. Ask an administrator if
							you need it. This attempt has been recorded.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<>
					<form
						onSubmit={applyFilters}
						className="bg-card flex flex-col gap-4 rounded-xl border p-4"
						aria-label="Audit log filters"
					>
						<div>
							<div className="bg-gold mb-2 h-1 w-10 rounded-full" />
							<h2 className="text-lg font-bold tracking-tight">Filters</h2>
							<p className="text-muted-foreground text-sm">
								Dates are Manila days, both included. Exports use the filters you applied.
							</p>
						</div>

						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="audit-from">From</Label>
								<Input
									id="audit-from"
									type="date"
									value={draft.from}
									max={draft.to || undefined}
									onChange={event => setField("from", event.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="audit-to">To</Label>
								<Input
									id="audit-to"
									type="date"
									value={draft.to}
									min={draft.from || undefined}
									onChange={event => setField("to", event.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="audit-actor">Actor</Label>
								<Input
									id="audit-actor"
									placeholder='Email, user ID or "system"'
									value={draft.actor}
									maxLength={255}
									onChange={event => setField("actor", event.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="audit-role">Actor role</Label>
								<Input
									id="audit-role"
									placeholder="e.g. Cashier"
									value={draft.role}
									maxLength={100}
									onChange={event => setField("role", event.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="audit-domain">Domain</Label>
								<Input
									id="audit-domain"
									placeholder="e.g. rbac"
									value={draft.domain}
									maxLength={100}
									onChange={event => setField("domain", event.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="audit-action">Action</Label>
								<Input
									id="audit-action"
									placeholder="e.g. role. or user.create"
									value={draft.action}
									maxLength={100}
									onChange={event => setField("action", event.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="audit-target-type">Target type</Label>
								<Input
									id="audit-target-type"
									placeholder="e.g. user, role"
									value={draft.targetType}
									maxLength={100}
									onChange={event => setField("targetType", event.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="audit-target-id">Target ID</Label>
								<Input
									id="audit-target-id"
									value={draft.targetId}
									maxLength={255}
									onChange={event => setField("targetId", event.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="audit-outcome">Outcome</Label>
								<Select
									items={OUTCOME_ITEMS}
									value={draft.outcome}
									onValueChange={value =>
										setField("outcome", (value ?? "all") as AuditFilterDraft["outcome"])
									}
								>
									<SelectTrigger id="audit-outcome" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{Object.entries(OUTCOME_ITEMS).map(([value, label]) => (
											<SelectItem key={value} value={value}>
												{label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						{formError ? (
							<p role="alert" className="text-destructive text-sm">
								{formError}
							</p>
						) : null}

						<div className="flex flex-wrap gap-2">
							<Button type="submit" size="sm">
								Apply filters
							</Button>
							<Button type="button" variant="outline" size="sm" onClick={clearFilters}>
								Clear
							</Button>
						</div>
					</form>

					{loading ? (
						<div className="flex flex-col gap-2" role="status" aria-label="Loading the audit log">
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</div>
					) : null}

					{!loading && query.isError ? (
						<p role="alert" className="text-destructive text-sm">
							{query.error.message}
						</p>
					) : null}

					{entries.length > 0 ? (
						// Wide content scrolls inside its own container so the page body
						// never scrolls sideways on a phone.
						<div className="overflow-x-auto rounded-lg border">
							<Table>
								<TableHeader className="bg-muted/50">
									<TableRow>
										<TableHead scope="col">When</TableHead>
										<TableHead scope="col">Actor</TableHead>
										<TableHead scope="col">Action</TableHead>
										<TableHead scope="col">Target</TableHead>
										<TableHead scope="col" className="w-0 text-right">
											<span className="sr-only">Open</span>
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{entries.map(entry => (
										<TableRow
											key={entry.id}
											className="cursor-pointer"
											onClick={() => setOpenEntry(entry)}
										>
											<TableCell className="align-top whitespace-nowrap">
												<time dateTime={entry.createdAt.toISOString()}>
													{formatAuditTime(entry.createdAt)}
												</time>
											</TableCell>
											<TableCell className="align-top">
												<div className="font-medium">{actorLabel(entry)}</div>
												{entry.actorRole ? (
													<div className="text-muted-foreground text-xs">{entry.actorRole}</div>
												) : null}
											</TableCell>
											<TableCell className="align-top">
												<div className="flex flex-wrap items-center gap-2">
													<span className="font-mono text-sm">{entry.action}</span>
													{entry.outcome === "denied" ? (
														<Badge variant="destructive">Denied</Badge>
													) : null}
												</div>
												<div className="text-muted-foreground text-xs">{entry.domain}</div>
											</TableCell>
											<TableCell className="align-top text-xs break-all">
												{targetLabel(entry)}
											</TableCell>
											<TableCell className="text-right align-top">
												<Button
													variant="outline"
													size="sm"
													onClick={event => {
														event.stopPropagation()
														setOpenEntry(entry)
													}}
													aria-label={`Open entry ${entry.id}`}
												>
													View
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					) : null}

					{!loading && query.hasNextPage ? (
						<Button
							variant="outline"
							className="self-center"
							onClick={() => void query.fetchNextPage()}
							disabled={query.isFetchingNextPage}
						>
							{query.isFetchingNextPage ? "Loading…" : "Load older entries"}
						</Button>
					) : null}

					{!loading && !query.isError && entries.length === 0 ? (
						<Empty className="border">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<HugeiconsIcon icon={ShieldKeyIcon} strokeWidth={2} />
								</EmptyMedia>
								<EmptyTitle>No matching entries</EmptyTitle>
								<EmptyDescription>Change or clear the filters to see more.</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : null}
				</>
			)}

			<AuditEntryDialog entry={openEntry} onClose={() => setOpenEntry(null)} />
		</section>
	)
}
