"use client"

import { useEffect, useRef, useState } from "react"

import { Button } from "@/core/components/ui/button"

/** The browser's built-in QR reader, where it exists (Chrome on Android, macOS, ChromeOS). */
interface BarcodeDetectorLike {
	detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike

function barcodeDetector(): BarcodeDetectorConstructor | null {
	const candidate = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector
	return typeof candidate === "function" ? candidate : null
}

/** True when this browser can read a QR code from the camera. */
export function canScanWithCamera(): boolean {
	return (
		typeof navigator !== "undefined" &&
		Boolean(navigator.mediaDevices?.getUserMedia) &&
		barcodeDetector() !== null
	)
}

/**
 * Reads a booking QR code through the device camera (PAY-4) and hands its
 * text (the Reference Number) to `onScan`. The camera turns off as soon as a
 * code is read or the scanner is closed. A handheld scanner needs none of
 * this: it types into the search box like a keyboard.
 */
export function QrCameraScanner({
	onScan,
	onClose,
}: {
	onScan: (value: string) => void
	onClose: () => void
}) {
	const videoRef = useRef<HTMLVideoElement>(null)
	// Known on the first render, so the effect never has to set it.
	const [error, setError] = useState<string | null>(() =>
		barcodeDetector() ? null : "This browser cannot read QR codes from the camera."
	)

	useEffect(() => {
		const Detector = barcodeDetector()
		if (!Detector) return
		const detector = new Detector({ formats: ["qr_code"] })
		let stream: MediaStream | null = null
		let timer: ReturnType<typeof setInterval> | null = null
		let stopped = false

		const stop = () => {
			stopped = true
			if (timer) clearInterval(timer)
			for (const track of stream?.getTracks() ?? []) track.stop()
		}

		navigator.mediaDevices
			.getUserMedia({ video: { facingMode: "environment" }, audio: false })
			.then(async media => {
				if (stopped) {
					for (const track of media.getTracks()) track.stop()
					return
				}
				stream = media
				const video = videoRef.current
				if (!video) return
				video.srcObject = media
				await video.play()
				timer = setInterval(() => {
					void detector
						.detect(video)
						.then(codes => {
							const value = codes[0]?.rawValue?.trim()
							if (value && !stopped) {
								stop()
								onScan(value)
							}
						})
						.catch(() => undefined)
				}, 300)
			})
			.catch(() => setError("The camera could not be opened. Allow camera access, or use a handheld scanner."))

		return stop
	}, [onScan])

	return (
		<div className="bg-card flex flex-col gap-3 rounded-xl border p-4">
			{error ? (
				<p role="alert" className="text-sm">
					{error} Type the Reference Number or use a handheld scanner instead.
				</p>
			) : (
				<>
					<p className="text-muted-foreground text-sm">Hold the booking QR code up to the camera.</p>
					<video
						ref={videoRef}
						className="aspect-video w-full max-w-md rounded-lg bg-black object-cover"
						muted
						playsInline
					/>
				</>
			)}
			<div>
				<Button type="button" variant="outline" onClick={onClose}>
					Close camera
				</Button>
			</div>
		</div>
	)
}
