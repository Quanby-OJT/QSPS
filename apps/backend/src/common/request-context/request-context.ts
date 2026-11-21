import { AsyncLocalStorage } from "node:async_hooks"
import type { NextFunction, Request, Response } from "express"

/**
 * Who sent the current request, for the audit trail (FND-3, TOR §VIII.1).
 *
 * Set once per request by {@link requestContextMiddleware} and read by
 * `AuditService.record`, so callers never pass the IP or user agent by hand.
 * Outside a request (scheduled jobs, scripts) there is no context, and the
 * audit entry stores null for both.
 */
export interface RequestContext {
	ipAddress: string | null
	userAgent: string | null
}

/** User-Agent headers can be any length; nothing useful lives past this. */
const USER_AGENT_MAX_LENGTH = 512

const storage = new AsyncLocalStorage<RequestContext>()

/**
 * The client address, by the same rule as `ThrottlerProxyGuard`: the
 * rightmost entry Express kept in `req.ips` after applying `trust proxy`
 * (TRUST_PROXY in bootstrap.ts), or `req.ip` for a direct connection.
 * Keep the two in step: if the guard's rule changes, change this too.
 */
export function clientAddress(req: Pick<Request, "ip" | "ips">): string | null {
	const ips = req.ips
	return ips?.[ips.length - 1] ?? req.ip ?? null
}

/** Express middleware that opens the request context for everything after it. */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
	const userAgent = req.headers["user-agent"]
	storage.run(
		{
			ipAddress: clientAddress(req),
			userAgent: typeof userAgent === "string" ? userAgent.slice(0, USER_AGENT_MAX_LENGTH) : null,
		},
		next
	)
}

/** The current request's context, or undefined outside a request. */
export function currentRequestContext(): RequestContext | undefined {
	return storage.getStore()
}

/** Run `fn` as if inside a request with this context. For tests and scripts. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
	return storage.run(context, fn)
}
