"use client"

import { useSyncExternalStore } from "react"

const subscribe = () => () => {}

/**
 * False on the server and on the client's first (hydrating) render, true
 * after that. A view whose query may already hold a restored snapshot on the
 * client shows its placeholder until this is true, so the server HTML and the
 * first client render always agree.
 */
export function useHydrated(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => true,
		() => false
	)
}
