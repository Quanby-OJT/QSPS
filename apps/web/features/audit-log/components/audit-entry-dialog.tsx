"use client"

import type { AuditLogEntry } from "@repo/contracts"

import { Badge } from "@/core/components/ui/badge"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/core/components/ui/dialog"
import { useAuditEntryQuery } from "@/features/audit-log/api/audit-log.hooks"
import {
	actorLabel,
	formatAuditTime,
	formatAuditValue,
	targetLabel,
} from "@/features/audit-log/lib/filters"

function Detail({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd className={mono ? "font-mono text-xs break-all" : "text-sm font-medium break-words"}>
				{value || "—"}
			</dd>
		</div>
	)
}

function ValueBlock({ label, value }: { label: string; value: unknown }) {
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<h3 className="text-sm font-semibold">{label}</h3>
			<pre className="bg-muted max-h-64 overflow-auto rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap break-all">
				{formatAuditValue(value)}
			</pre>
		</div>
	)
}

/**
 * ADM-3: one Audit Entry, opened. Read-only by design: an entry cannot be
 * edited or removed, so the dialog offers nothing but Close.
 */
export function AuditEntryDialog({
	entry,
	onClose,
}: {
	entry: AuditLogEntry | null
	onClose: () => void
}) {
	const detail = useAuditEntryQuery(entry?.id ?? null)

	return (
		<Dialog open={entry !== null} onOpenChange={open => !open && onClose()}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				{entry ? (
					<>
						<DialogHeader>
							<div className="bg-gold mb-1 h-1 w-10 rounded-full" />
							<DialogTitle className="flex flex-wrap items-center gap-2">
								<span className="font-mono">{entry.action}</span>
								{entry.outcome === "denied" ? (
									<Badge variant="destructive">Denied</Badge>
								) : (
									<Badge variant="outline" className="border-success/30 bg-success/10 text-success">
										Success
									</Badge>
								)}
							</DialogTitle>
							<DialogDescription>
								Entry #{entry.id} · {formatAuditTime(entry.createdAt)} (Manila time)
							</DialogDescription>
						</DialogHeader>

						<dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<Detail label="Actor" value={actorLabel(entry)} />
							<Detail label="Actor role at the time" value={entry.actorRole} />
							<Detail label="Domain" value={entry.domain} />
							<Detail label="Target" value={targetLabel(entry)} />
							<Detail label="IP address" value={entry.ipAddress} mono />
							<Detail label="Device" value={entry.userAgent} mono />
							{entry.reason ? (
								<div className="sm:col-span-2">
									<Detail label="Reason" value={entry.reason} />
								</div>
							) : null}
						</dl>

						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<ValueBlock label="Before" value={entry.oldValue} />
							<ValueBlock label="After" value={entry.newValue} />
						</div>

						<dl className="border-t pt-3">
							<Detail
								label="Entry hash"
								mono
								value={
									detail.isPending
										? "Loading…"
										: detail.isError
											? detail.error.message
											: (detail.data.entryHash ?? "Recorded before the hash chain started")
								}
							/>
						</dl>
					</>
				) : null}
			</DialogContent>
		</Dialog>
	)
}