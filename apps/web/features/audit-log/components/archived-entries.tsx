"use client"

import type { ArchivedAuditLogEntry, ArchivedAuditLogResponse } from "@repo/contracts"

import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/core/components/ui/table"
import { actorLabel, formatAuditTime, targetLabel } from "@/features/audit-log/lib/filters"

/**
 * OPS-4: entries the retention job moved to the archive that match the same
 * filters. Shown only when there is something to show.
 */
export function ArchivedEntries({
	data,
	onOpen,
}: {
	data: ArchivedAuditLogResponse | undefined
	onOpen: (entry: ArchivedAuditLogEntry) => void
}) {
	if (!data || (data.entries.length === 0 && data.unreadableFiles === 0)) return null

	return (
		<section className="flex flex-col gap-2" aria-labelledby="archived-entries-heading">
			<div>
				<div className="bg-gold mb-2 h-1 w-10 rounded-full" />
				<h2 id="archived-entries-heading" className="text-lg font-bold tracking-tight">
					Archived entries
				</h2>
				<p className="text-muted-foreground text-sm">
					Older entries the retention policy moved to the archive. They match the same filters and
					cannot be edited or removed.
					{data.truncated
						? " Only the newest 500 matches are shown; narrow the dates to see older ones."
						: null}
				</p>
			</div>

			{data.unreadableFiles > 0 ? (
				<p role="alert" className="text-destructive text-sm">
					{data.unreadableFiles} archive file(s) could not be read or did not match their checksum.
				</p>
			) : null}

			{data.entries.length > 0 ? (
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
							{data.entries.map(entry => (
								<TableRow key={entry.id} className="cursor-pointer" onClick={() => onOpen(entry)}>
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
											<Badge variant="secondary">Archived</Badge>
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
												onOpen(entry)
											}}
											aria-label={`Open archived entry ${entry.id}`}
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
		</section>
	)
}
