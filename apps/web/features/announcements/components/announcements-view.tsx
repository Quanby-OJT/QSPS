"use client"

import { useState } from "react"
import { AccountSetting01Icon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"

import { MAX_ANNOUNCEMENT_TITLE_LENGTH, type Announcement } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { Skeleton } from "@/core/components/ui/skeleton"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { ApiError } from "@/core/lib/api-error"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import {
	announcementMediaUrl,
	useAnnouncementsQuery,
	useCreateAnnouncementMutation,
	useSetAnnouncementActiveMutation,
	useUpdateAnnouncementMutation,
	useUploadAnnouncementMediaMutation,
} from "@/features/announcements/api/announcements.hooks"
import { AnnouncementMedia } from "@/features/announcements/components/announcement-media"
import {
	draftFrom,
	emptyDraft,
	formatAnnouncementDate,
	parseAnnouncementDraft,
	stateLabel,
	type AnnouncementDraft,
} from "@/features/announcements/lib/announcements"

type Editing = { mode: "new" } | { mode: "edit"; announcement: Announcement } | null

/**
 * AUTH-4: the Gender and Development flash screen clients see before the
 * sign-in form. Needs settings.announcements:manage.
 */
export function AnnouncementsView() {
	const query = useAnnouncementsQuery()
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()
	const [editing, setEditing] = useState<Editing>(null)
	const loading = !hydrated || isQueryLoading(query)
	const forbidden = query.error instanceof ApiError && query.error.status === 403

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				icon={AccountSetting01Icon}
				title="Announcements"
				description="The Gender and Development flash screen clients see before the sign-in form."
			/>

			{forbidden ? (
				<p className="text-muted-foreground text-sm">You do not have access to announcements.</p>
			) : (
				<section className="bg-card rounded-xl border p-4" aria-labelledby="announcements-heading">
					<div className="bg-gold mb-2 h-1 w-10 rounded-full" />
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="min-w-0">
							<h2 id="announcements-heading" className="text-lg font-bold tracking-tight">
								Flash screen
							</h2>
							<p className="text-muted-foreground mt-1 text-sm">
								An active announcement inside its dates is shown before sign-in. When several
								qualify, the one with the latest start is shown.
							</p>
						</div>
						{editing === null ? (
							<Button type="button" size="sm" onClick={() => setEditing({ mode: "new" })}>
								New announcement
							</Button>
						) : null}
					</div>

					{editing ? (
						<AnnouncementEditor
							key={editing.mode === "edit" ? editing.announcement.id : "new"}
							announcement={editing.mode === "edit" ? editing.announcement : null}
							onClose={() => setEditing(null)}
						/>
					) : null}

					{loading ? (
						<div
							className="mt-4 flex flex-col gap-2"
							role="status"
							aria-label="Loading announcements"
						>
							<Skeleton className="h-20 w-full rounded-lg" />
							<Skeleton className="h-20 w-full rounded-lg" />
						</div>
					) : query.isError ? (
						<div className="border-destructive/30 bg-destructive/5 mt-4 rounded-lg border p-4">
							<p className="text-sm font-medium">Could not load the announcements.</p>
							<p className="text-muted-foreground mt-1 text-sm">{query.error.message}</p>
							<Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>
								Retry
							</Button>
						</div>
					) : !query.data || query.data.length === 0 ? (
						<p className="text-muted-foreground mt-4 text-sm">
							No announcements yet. Clients go straight to the sign-in form.
						</p>
					) : (
						<ul className="mt-2 flex flex-col">
							{query.data.map(announcement => (
								<AnnouncementRow
									key={`${announcement.id}:${announcement.state}:${String(announcement.updatedAt)}`}
									announcement={announcement}
									onEdit={() => setEditing({ mode: "edit", announcement })}
									editingDisabled={editing !== null}
								/>
							))}
						</ul>
					)}
				</section>
			)}
		</section>
	)
}

function AnnouncementRow({
	announcement,
	onEdit,
	editingDisabled,
}: {
	announcement: Announcement
	onEdit: () => void
	editingDisabled: boolean
}) {
	const setActive = useSetAnnouncementActiveMutation()
	const [showMedia, setShowMedia] = useState(false)

	async function toggleActive() {
		const isActive = !announcement.isActive
		try {
			await setActive.mutateAsync({ id: announcement.id, isActive })
			toast.success(`${announcement.title} ${isActive ? "activated" : "deactivated"}`)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not change the announcement")
		}
	}

	return (
		<li
			className="flex flex-col gap-2 border-t py-4 first:border-t-0"
			aria-label={announcement.title}
		>
			<div className="flex flex-wrap items-center gap-2">
				<p className="font-semibold">{announcement.title}</p>
				<Badge variant={announcement.state === "showing" ? "default" : "secondary"}>
					{stateLabel(announcement.state)}
				</Badge>
				<Badge variant="outline">{announcement.mediaType === "video" ? "Video" : "Image"}</Badge>
			</div>
			<p className="text-muted-foreground text-xs">
				From {formatAnnouncementDate(announcement.startsAt)}
				{announcement.endsAt
					? ` until ${formatAnnouncementDate(announcement.endsAt)}`
					: " with no end date"}
				{announcement.createdByEmail ? <> &middot; by {announcement.createdByEmail}</> : null}
			</p>
			{showMedia ? (
				<div className="bg-muted max-w-xl overflow-hidden rounded-lg">
					<AnnouncementMedia
						src={announcementMediaUrl(announcement.previewPath)}
						mediaType={announcement.mediaType}
						title={announcement.title}
					/>
				</div>
			) : null}
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-expanded={showMedia}
					onClick={() => setShowMedia(current => !current)}
				>
					{showMedia ? "Hide file" : "Show file"}
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={editingDisabled}
					onClick={onEdit}
				>
					Edit
				</Button>
				<Button
					type="button"
					variant={announcement.isActive ? "outline" : "default"}
					size="sm"
					disabled={setActive.isPending}
					onClick={() => void toggleActive()}
				>
					{setActive.isPending ? "Saving..." : announcement.isActive ? "Deactivate" : "Activate"}
				</Button>
			</div>
		</li>
	)
}

function AnnouncementEditor({
	announcement,
	onClose,
}: {
	announcement: Announcement | null
	onClose: () => void
}) {
	const upload = useUploadAnnouncementMediaMutation()
	const create = useCreateAnnouncementMutation()
	const update = useUpdateAnnouncementMutation()
	const [draft, setDraft] = useState<AnnouncementDraft>(() =>
		announcement ? draftFrom(announcement) : emptyDraft()
	)
	const [fileName, setFileName] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const busy = upload.isPending || create.isPending || update.isPending

	function change(patch: Partial<AnnouncementDraft>) {
		setDraft(current => ({ ...current, ...patch }))
		setError(null)
	}

	async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0]
		event.target.value = ""
		if (!file) return
		setError(null)
		try {
			const uploaded = await upload.mutateAsync(file)
			change({ mediaKey: uploaded.mediaKey, mediaType: uploaded.mediaType })
			setFileName(file.name)
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Could not upload the file")
		}
	}

	async function save(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const parsed = parseAnnouncementDraft(draft)
		if (!parsed.ok) {
			setError(parsed.message)
			return
		}
		try {
			if (announcement) {
				await update.mutateAsync({ ...parsed.value, id: announcement.id })
				toast.success(`${parsed.value.title} saved`)
			} else {
				await create.mutateAsync(parsed.value)
				toast.success(`${parsed.value.title} created. Activate it to show it before sign-in.`)
			}
			onClose()
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Could not save the announcement")
		}
	}

	return (
		<form
			aria-label={announcement ? `Edit ${announcement.title}` : "New announcement"}
			noValidate
			onSubmit={event => void save(event)}
			className="border-primary/40 bg-muted/30 mt-4 flex flex-col gap-4 rounded-lg border p-4"
		>
			<p className="text-sm font-semibold">
				{announcement ? `Edit ${announcement.title}` : "New announcement"}
			</p>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor="announcement-title">Title</Label>
				<Input
					id="announcement-title"
					value={draft.title}
					maxLength={MAX_ANNOUNCEMENT_TITLE_LENGTH}
					onChange={event => change({ title: event.target.value })}
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor="announcement-file">Image or video</Label>
				<Input
					id="announcement-file"
					type="file"
					accept="image/jpeg,image/png,video/mp4"
					disabled={busy}
					onChange={event => void chooseFile(event)}
				/>
				<p className="text-muted-foreground text-xs" aria-live="polite">
					{upload.isPending
						? "Uploading..."
						: fileName
							? `Uploaded: ${fileName}`
							: announcement
								? "The current file is kept unless you upload a new one."
								: "JPG or PNG up to 5 MB, or MP4 up to 20 MB."}
				</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="announcement-starts">Starts (Manila time)</Label>
					<Input
						id="announcement-starts"
						type="datetime-local"
						value={draft.startsAt}
						onChange={event => change({ startsAt: event.target.value })}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="announcement-ends">Ends (optional)</Label>
					<Input
						id="announcement-ends"
						type="datetime-local"
						value={draft.endsAt}
						onChange={event => change({ endsAt: event.target.value })}
					/>
					<p className="text-muted-foreground text-xs">Leave blank to show it until deactivated.</p>
				</div>
			</div>

			{error ? (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			) : null}

			<div className="flex flex-wrap gap-2">
				<Button type="submit" disabled={busy}>
					{create.isPending || update.isPending ? "Saving..." : "Save"}
				</Button>
				<Button type="button" variant="outline" onClick={onClose} disabled={busy}>
					Cancel
				</Button>
			</div>
		</form>
	)
}
