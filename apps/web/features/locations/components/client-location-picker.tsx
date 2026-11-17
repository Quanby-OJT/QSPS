"use client"

import { useState } from "react"

import { Button } from "@/core/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/core/components/ui/card"
import { Label } from "@/core/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/core/components/ui/select"
import { useAvailableLocationsQuery } from "@/features/locations/api/locations.hooks"

export function ClientLocationPicker() {
	const locations = useAvailableLocationsQuery()
	const [selectedCode, setSelectedCode] = useState("")
	const selectedLocation = locations.data?.find(location => location.code === selectedCode)

	return (
		<Card>
			<CardHeader>
				<CardTitle>Choose a BOQ location</CardTitle>
				<CardDescription>Select an active office for the services you need.</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-3">
				{locations.isPending ? (
					<p className="text-muted-foreground text-sm" role="status">
						Loading locations…
					</p>
				) : locations.isError ? (
					<div>
						<p className="text-destructive text-sm">Could not load locations.</p>
						<Button
							className="mt-2"
							variant="outline"
							size="sm"
							onClick={() => void locations.refetch()}
						>
							Retry
						</Button>
					</div>
				) : locations.data.length === 0 ? (
					<p className="text-muted-foreground text-sm" role="status">
						No active BOQ locations are available right now.
					</p>
				) : (
					<>
						<div className="grid gap-2">
							<Label htmlFor="client-location">Location</Label>
							<Select value={selectedCode} onValueChange={value => setSelectedCode(value ?? "")}>
								<SelectTrigger
									id="client-location"
									aria-label="Choose a BOQ location"
									className="w-full"
								>
									<SelectValue>
										{selectedLocation
											? `${selectedLocation.name} — ${selectedLocation.region}`
											: "Select a location"}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{locations.data.map(location => (
										<SelectItem key={location.code} value={location.code}>
											{location.name} — {location.region}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						{selectedLocation ? (
							<div className="bg-muted/50 rounded-md p-3" role="status" aria-live="polite">
								<p className="text-sm font-medium">{selectedLocation.name}</p>
								<p className="text-muted-foreground mt-1 text-sm">{selectedLocation.address}</p>
							</div>
						) : null}
					</>
				)}
			</CardContent>
		</Card>
	)
}
