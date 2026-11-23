"use client"

import { useState } from "react"
import { toast } from "sonner"

import type { PaymentChannel } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/core/components/ui/dialog"
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
import { ApiError } from "@/core/lib/api-error"
import {
	usePaymentChannelSettingsQuery,
	useUpdatePaymentChannelMutation,
} from "@/features/payments/api/payment-channels.hooks"
import { feeInPesos, parseFeeCentavos } from "@/features/services/lib/fee"

/** Same limit as MAX_CONVENIENCE_FEE_CENTAVOS in @repo/contracts: PHP 10,000.00. */
const MAX_FIXED_FEE_CENTAVOS = 1_000_000

type ChannelForm = {
	name: string
	providerCode: string
	fixedFee: string
	percent: string
	isEnabled: boolean
}

/** 250 basis points → "2.5". */
function bpsToPercent(bps: number): string {
	return String(bps / 100)
}

/** "2.5" → 250; null when not a percentage from 0 to 100 with up to two decimals. */
function parsePercentBps(value: string): number | null {
	const trimmed = value.trim()
	if (trimmed === "") return 0
	if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null
	const bps = Math.round(Number(trimmed) * 100)
	return bps <= 10_000 ? bps : null
}

function describeFee(channel: PaymentChannel): string {
	const parts: string[] = []
	if (channel.convenienceFeeCentavos > 0) parts.push(`₱${feeInPesos(channel.convenienceFeeCentavos)}`)
	if (channel.convenienceFeeBps > 0) parts.push(`${bpsToPercent(channel.convenienceFeeBps)}%`)
	return parts.length > 0 ? parts.join(" + ") : "No fee"
}

/**
 * Payment Channels (PAY-5): turn channels on, choose the provider that
 * serves each, and set its convenience fee. Changes apply to new payments
 * only and are audited with old and new values.
 */
export function PaymentChannelsView() {
	const settings = usePaymentChannelSettingsQuery()
	const updateChannel = useUpdatePaymentChannelMutation()

	const [editing, setEditing] = useState<PaymentChannel | null>(null)
	const [form, setForm] = useState<ChannelForm | null>(null)
	const [saveKey, setSaveKey] = useState(() => crypto.randomUUID())

	const providerCodes = settings.data?.providerCodes ?? []

	function startEdit(channel: PaymentChannel) {
		setEditing(channel)
		setSaveKey(crypto.randomUUID())
		setForm({
			name: channel.name,
			providerCode: channel.providerCode ?? "",
			fixedFee: feeInPesos(channel.convenienceFeeCentavos),
			percent: bpsToPercent(channel.convenienceFeeBps),
			isEnabled: channel.isEnabled,
		})
	}

	function close() {
		setEditing(null)
		setForm(null)
	}

	async function save(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!editing || !form) return

		const convenienceFeeCentavos = parseFeeCentavos(form.fixedFee.trim() === "" ? "0" : form.fixedFee)
		if (convenienceFeeCentavos === null || convenienceFeeCentavos > MAX_FIXED_FEE_CENTAVOS) {
			toast.error("Enter a fixed fee in pesos, up to ₱10,000.00, with no more than two decimals")
			return
		}
		const convenienceFeeBps = parsePercentBps(form.percent)
		if (convenienceFeeBps === null) {
			toast.error("Enter a percentage from 0 to 100, with no more than two decimals")
			return
		}
		if (form.isEnabled && form.providerCode === "") {
			toast.error("Choose a provider before enabling the channel")
			return
		}

		try {
			await updateChannel.mutateAsync({
				code: editing.code,
				name: form.name,
				providerCode: form.providerCode === "" ? null : form.providerCode,
				convenienceFeeCentavos,
				convenienceFeeBps,
				isEnabled: form.isEnabled,
				idempotencyKey: saveKey,
			})
			toast.success(`${form.name} saved`)
			close()
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save the channel")
			setSaveKey(crypto.randomUUID())
		}
	}

	return (
		<section className="flex flex-col gap-6">
			<PageHeader title="Payment Channels" />
			<p className="text-muted-foreground max-w-2xl text-sm">
				Choose which channels clients can pay with, the payment provider that serves each, and its
				convenience fee. Clients see the fee before they pay. Changes apply to new payments only.
			</p>

			{settings.isPending ? (
				<p className="text-muted-foreground text-sm">Loading payment channels…</p>
			) : settings.isError ? (
				<p role="alert" className="text-sm">
					{settings.error instanceof ApiError && settings.error.status === 403
						? "You do not have access to payment channels. Managing them needs the settings.payment-channels:manage permission. This attempt has been recorded."
						: settings.error.message}
				</p>
			) : (
				<div className="rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Channel</TableHead>
								<TableHead>Code</TableHead>
								<TableHead>Provider</TableHead>
								<TableHead>Convenience fee</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{settings.data.channels.map(channel => (
								<TableRow key={channel.code}>
									<TableCell className="font-medium">{channel.name}</TableCell>
									<TableCell className="font-mono text-xs">{channel.code}</TableCell>
									<TableCell className="font-mono text-xs">{channel.providerCode ?? "—"}</TableCell>
									<TableCell>{describeFee(channel)}</TableCell>
									<TableCell>
										<Badge variant={channel.isEnabled ? "default" : "secondary"}>
											{channel.isEnabled ? "Enabled" : "Disabled"}
										</Badge>
									</TableCell>
									<TableCell>
										<div className="flex justify-end">
											<Button variant="outline" size="sm" onClick={() => startEdit(channel)}>
												Configure
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			<Dialog open={editing !== null} onOpenChange={open => (open ? undefined : close())}>
				<DialogContent className="sm:max-w-lg">
					{editing && form ? (
						<form className="flex flex-col gap-4" onSubmit={event => void save(event)}>
							<DialogHeader>
								<DialogTitle>Configure {editing.name}</DialogTitle>
								<DialogDescription>
									The fee is a fixed amount plus a percentage of the Service fees; either can be 0.
									Changes apply to new payments only.
								</DialogDescription>
							</DialogHeader>

							<div className="grid gap-4">
								<div className="grid gap-2">
									<Label htmlFor="channel-name">Name shown to clients</Label>
									<Input
										id="channel-name"
										value={form.name}
										onChange={event => setForm({ ...form, name: event.target.value })}
										maxLength={60}
										required
									/>
								</div>

								<div className="grid gap-2">
									<Label htmlFor="channel-provider">Payment provider</Label>
									<select
										id="channel-provider"
										className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-lg border px-3 text-sm focus-visible:ring-[3px]"
										value={form.providerCode}
										onChange={event => setForm({ ...form, providerCode: event.target.value })}
										aria-describedby="channel-provider-help"
									>
										<option value="">No provider</option>
										{providerCodes.map(code => (
											<option key={code} value={code}>
												{code}
											</option>
										))}
									</select>
									<p id="channel-provider-help" className="text-muted-foreground text-xs">
										{providerCodes.length === 0
											? "No payment provider is set up in this deployment yet."
											: "The next payment through this channel goes to this provider."}
									</p>
								</div>

								<div className="grid grid-cols-2 gap-4">
									<div className="grid gap-2">
										<Label htmlFor="channel-fixed-fee">Fixed fee (PHP)</Label>
										<Input
											id="channel-fixed-fee"
											type="number"
											inputMode="decimal"
											min="0"
											step="0.01"
											value={form.fixedFee}
											onChange={event => setForm({ ...form, fixedFee: event.target.value })}
										/>
									</div>
									<div className="grid gap-2">
										<Label htmlFor="channel-percent">Percentage (%)</Label>
										<Input
											id="channel-percent"
											type="number"
											inputMode="decimal"
											min="0"
											max="100"
											step="0.01"
											value={form.percent}
											onChange={event => setForm({ ...form, percent: event.target.value })}
										/>
									</div>
								</div>

								<label className="flex items-center gap-2 text-sm" htmlFor="channel-enabled">
									<input
										id="channel-enabled"
										type="checkbox"
										checked={form.isEnabled}
										onChange={event => setForm({ ...form, isEnabled: event.target.checked })}
										className="accent-primary size-4"
									/>
									Offer this channel at checkout
								</label>
							</div>

							<DialogFooter>
								<Button type="button" variant="outline" onClick={close}>
									Cancel
								</Button>
								<Button type="submit" disabled={updateChannel.isPending}>
									{updateChannel.isPending ? "Saving…" : "Save"}
								</Button>
							</DialogFooter>
						</form>
					) : null}
				</DialogContent>
			</Dialog>
		</section>
	)
}
