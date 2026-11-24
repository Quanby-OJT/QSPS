import { inScope, type ResolvedScope } from "@/common/scope/scope-match"

/**
 * Whether a cashier may see and collect for a booking (PAY-4): one of its
 * items is at a Location the cashier's Scope covers.
 *
 * Only the Location is checked, not the Service Category. A cashier's Scope
 * names the `cashier` category, while the Services they collect for belong to
 * other categories (immunization, physical-exam…), so matching the category
 * would hide every booking. The ticket's rule is "a permitted user at their
 * Location".
 */
export function visibleToCashier(items: { locationId: number }[], scope: ResolvedScope): boolean {
	return items.some(item => inScope(scope, { locationId: item.locationId }))
}
