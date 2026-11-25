"use client"

import { useState } from "react"
import { toast } from "sonner"

import type { SeminarAttendanceResult, SeminarAttendee, SeminarIssueResult } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/core/components/ui/table"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { cn } from "@/core/lib/utils"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import {
	useSeminarAttendanceMutation,
	useSeminarIssueMutation,
	useSeminarRosterQuery,
	useSeminarSessionsQuery,
} from "@/features/certificates/api/seminars.hooks"
import {
	attendeeStatusLabel,
	canIssue,
	canMarkAbsent,
	canMarkPresent,
	selectedFor,
	sessionSummary,
} from "@/features/certificates/lib/seminars"
import { manilaDateKey } from "@/features/schedules/lib/calendar"

const timeFormatter = new Intl.DateTimeFormat("en-PH", {
	timeZone: "Asia/Manila",
	hour: "numeric",
	minute: "2-digit",
})

function newKey(): string {
	return crypto.randomUUID()
}

/** What happened to each attendee, in the words the API gave. */
function ResultList({
	results,
	names,
}: {
	results: readonly { bookingItemId: number; outcome: string; message: string }[]
	names: ReadonlyMap<number, string>
}) {
	if (results.length === 0) return null
	return (
		<ul className="flex flex-col gap-1 rounded-lg border p-3 text-sm" aria-label="Result">
			{results.map(result => (
				<li key={result.bookingItemId} className="flex flex-wrap items-center gap-2">
					<Badge
						variant={
							result.outcome === "refused" || result.outcome === "not_found"
								? "destructive"
								: "secondary"
						}
					>
						{result.outcome.replaceAll("_", " ")}
					</Badge>
					<span className="font-medium">
						{names.get(result.bookingItemId) ?? `Attendee ${result.bookingItemId}`}
					</span>
					<span className="text-muted-foreground">{result.message}</span>
				</li>
			))}
		</ul>
	)
}

/** The roster of one session: tick attendees, mark them present or absent, issue certificates. */
function Roster({ scheduleSlotId }: { scheduleSlotId: number }) {
	const roster = useSeminarRosterQuery(scheduleSlotId)
	const attendance = useSeminarAttendanceMutation(scheduleSlotId)
	const issue = useSeminarIssueMutation(scheduleSlotId)
	const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
	const [results, setResults] = useState<
		SeminarAttendanceResult["results"] | SeminarIssueResult["results"]
	>([])
	// One key per click of Issue, so a double click issues once.
	const [issueKey, setIssueKey] = useState(newKey)

	const attendees: readonly SeminarAttendee[] = roster.data?.attendees ?? []
	const names = new Map(attendees.map(attendee => [attendee.bookingItemId, attendee.clientName]))
	const busy = attendance.isPending || issue.isPending

	const toPresent = selectedFor(attendees, selected, canMarkPresent)
	const toAbsent = selectedFor(attendees, selected, canMarkAbsent)
	const readyForCertificate = attendees.filter(canIssue).length
	const toIssue = selectedFor(attendees, selected, canIssue)

	function toggle(id: number) {
		setSelected(current => {
			const next = new Set(current)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	function toggleAll() {
		setSelected(current =>
			current.size === attendees.length ? new Set() : new Set(attendees.map(a => a.bookingItemId))
		)
	}

	async function mark(kind: "present" | "absent") {
		const ids = kind === "present" ? toPresent : toAbsent
		if (ids.length === 0) return
		try {
			const outcome = await attendance.mutateAsync({
				present: kind === "present" ? ids : [],
				absent: kind === "absent" ? ids : [],
			})
			setResults(outcome.results)
			setSelected(new Set())
			const done = outcome.results.filter(r => r.outcome === kind).length
			toast.success(`${done} marked ${kind}`)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not mark attendance")
		}
	}

	async function issueCertificates(ids: number[] | undefined) {
		try {
			const outcome = await issue.mutateAsync({ bookingItemIds: ids, idempotencyKey: issueKey })
			setIssueKey(newKey())
			setResults(outcome.results)
			setSelected(new Set())
			const done = outcome.results.filter(r => r.outcome === "issued").length
			toast.success(`${done} certificate${done === 1 ? "" : "s"} issued`)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not issue the certificates")
		}
	}

	if (roster.isPending) {
		return (
			<p className="text-muted-foreground text-sm" role="status">
				Loading the roster…
			</p>
		)
	}
	if (roster.error) {
		return (
			<p className="text-destructive text-sm" role="alert">
				{roster.error.message}
			</p>
		)
	}

	return (
		<div className="flex flex-col gap-4">
			<p className="text-muted-foreground text-sm">
				{sessionSummary(roster.data.session)}. Only paid attendees can be marked.
			</p>

			{attendees.length === 0 ? (
				<p className="text-muted-foreground rounded-xl border p-6 text-sm">
					Nobody has booked this session yet.
				</p>
			) : (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							size="sm"
							disabled={busy || toPresent.length === 0}
							onClick={() => void mark("present")}
						>
							Mark present ({toPresent.length})
						</Button>
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={busy || toAbsent.length === 0}
							onClick={() => void mark("absent")}
						>
							Mark absent ({toAbsent.length})
						</Button>
						<Button
							type="button"
							size="sm"
							variant="secondary"
							disabled={busy || (toIssue.length === 0 && readyForCertificate === 0)}
							onClick={() => void issueCertificates(toIssue.length > 0 ? toIssue : undefined)}
						>
							{toIssue.length > 0
								? `Issue certificates (${toIssue.length})`
								: `Issue to all present (${readyForCertificate})`}
						</Button>
					</div>

					<div className="rounded-xl border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-10">
										<input
											type="checkbox"
											aria-label="Select all attendees"
											checked={selected.size === attendees.length}
											onChange={toggleAll}
										/>
									</TableHead>
									<TableHead>Client</TableHead>
									<TableHead>Reference Number</TableHead>
									<TableHead>Payment</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Certificate</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{attendees.map(attendee => (
									<TableRow key={attendee.bookingItemId}>
										<TableCell>
											<input
												type="checkbox"
												aria-label={`Select ${attendee.clientName}`}
												checked={selected.has(attendee.bookingItemId)}
												onChange={() => toggle(attendee.bookingItemId)}
											/>
										</TableCell>
										<TableCell className="font-medium">{attendee.clientName}</TableCell>
										<TableCell className="font-mono text-xs">{attendee.referenceNumber}</TableCell>
										<TableCell>
											<Badge variant={attendee.paymentStatus === "paid" ? "secondary" : "outline"}>
												{attendee.paymentStatus === "paid" ? "Paid" : "Unpaid"}
											</Badge>
										</TableCell>
										<TableCell className="text-sm">{attendeeStatusLabel(attendee)}</TableCell>
										<TableCell className="font-mono text-xs">
											{attendee.documentNumber ?? "—"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</>
			)}

			<ResultList results={results} names={names} />
		</div>
	)
}

/**
 * Seminar sessions (CRT-6, TOR §VIII.3): the day's Basic Hygiene and Sanitation
 * seminars at the caller's Locations. Pick a session to see who booked it, mark
 * attendees present or absent, and issue Food Safety Training Certificates to
 * everyone present in one go. Each attendee is handled on its own, so one that
 * cannot be marked or certified never blocks the others.
 *
 * Hydration-safe: the list shows its loading line on the server and on the
 * client's first render, so the two renders agree.
 */
export function SeminarSessions() {
	const [date, setDate] = useState(() => manilaDateKey(new Date()))
	const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
	const sessions = useSeminarSessionsQuery(date)
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()
	const loading = !hydrated || isQueryLoading(sessions) || (!sessions.isError && !sessions.data)

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				title="Seminars"
				description="Mark who attended a Basic Hygiene and Sanitation seminar and issue their Food Safety Training Certificates."
			/>

			<div className="flex max-w-xs flex-col gap-1.5">
				<Label htmlFor="seminar-date">Date</Label>
				<Input
					id="seminar-date"
					type="date"
					value={date}
					onChange={event => {
						if (!event.target.value) return
						setDate(event.target.value)
						setSelectedSlot(null)
					}}
				/>
			</div>

			{loading ? (
				<p className="text-muted-foreground text-sm" role="status">
					Loading…
				</p>
			) : sessions.error ? (
				<p className="text-destructive text-sm" role="alert">
					{sessions.error.message}
				</p>
			) : !sessions.data || sessions.data.sessions.length === 0 ? (
				<p className="text-muted-foreground rounded-xl border p-6 text-sm">
					No seminar sessions on this date in your scope.
				</p>
			) : (
				<ul className="flex flex-col gap-3">
					{sessions.data.sessions.map(session => {
						const open = selectedSlot === session.scheduleSlotId
						return (
							<li
								key={session.scheduleSlotId}
								className="bg-card flex flex-col gap-4 rounded-xl border p-4"
							>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div className="flex min-w-0 flex-col gap-0.5">
										<span className="font-semibold">{session.serviceName}</span>
										<span className="text-muted-foreground text-sm">
											{timeFormatter.format(session.startsAt)} –{" "}
											{timeFormatter.format(session.endsAt)} · {session.locationName}
										</span>
										<span className="text-muted-foreground text-xs">{sessionSummary(session)}</span>
									</div>
									<Button
										type="button"
										variant={open ? "default" : "outline"}
										aria-expanded={open}
										className={cn("w-full sm:w-auto")}
										onClick={() => setSelectedSlot(open ? null : session.scheduleSlotId)}
									>
										{open ? "Hide roster" : "Open roster"}
									</Button>
								</div>
								{open ? <Roster scheduleSlotId={session.scheduleSlotId} /> : null}
							</li>
						)
					})}
				</ul>
			)}
		</section>
	)
}
