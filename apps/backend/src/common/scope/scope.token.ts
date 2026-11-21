import type { ResolvedScope } from "./scope-match"

/**
 * Injection token for the Scope resolver (ADM-2). Controllers inject by this
 * token instead of the `ScopeService` class, so loading a controller does not
 * load `RbacService` and the contracts package with it (Jest cannot read the
 * ESM-only oRPC packages those pull in).
 */
export const SCOPE_RESOLVER = "QSPS_SCOPE_RESOLVER"

export interface ScopeResolver {
	resolve(userId: string | null): Promise<ResolvedScope>
}

/**
 * What a controller uses when no resolver is wired in: no Scope at all, so a
 * wiring mistake fails closed (scoped staff see nothing) instead of open.
 */
export const NO_SCOPE: ResolvedScope = { nationwide: false, entries: [] }
