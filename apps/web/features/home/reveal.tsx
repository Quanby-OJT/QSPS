"use client"

import { useEffect, useRef } from "react"

import { cn } from "@/core/lib/utils"

/**
 * Fades its content up when it scrolls into view (UI-1). Content is visible
 * by default and is only hidden once this runs, so nothing stays hidden if
 * scripts fail; people who turn off animations see it straight away.
 *
 * The hidden/shown state lives in a data attribute on the element, not in
 * React state, so scrolling never re-renders the cards.
 */
export function Reveal({
	children,
	className,
	delay = 0,
}: {
	children: React.ReactNode
	className?: string
	/** Milliseconds, to stagger items in a row. */
	delay?: number
}) {
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const element = ref.current
		if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
		if (!("IntersectionObserver" in window)) return

		element.dataset.reveal = "hidden"
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting) {
					element.dataset.reveal = "shown"
					observer.disconnect()
				}
			},
			{ rootMargin: "0px 0px -10% 0px" }
		)
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	return (
		<div
			ref={ref}
			style={{ transitionDelay: `${delay}ms` }}
			className={cn(
				"transition-[opacity,translate] duration-700 ease-out",
				"data-[reveal=hidden]:translate-y-6 data-[reveal=hidden]:opacity-0",
				className
			)}
		>
			{children}
		</div>
	)
}
