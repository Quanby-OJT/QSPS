/**
 * Masked holder names for public verification (CRT-2). Enough to recognise
 * the document in hand ("J*** D*** C***" for Juan Dela Cruz), not enough to
 * learn who holds it. Every word gets the same three stars, so the mask does
 * not reveal how long the name is.
 */
export function maskName(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean)
	if (words.length === 0) return "-"
	return words.map(word => `${Array.from(word)[0]?.toUpperCase() ?? ""}***`).join(" ")
}

/** The holder's name from a document payload; every document type stores it under `holder.name`. */
export function holderNameOf(payload: Record<string, unknown>): string {
	const holder = payload.holder
	if (holder && typeof holder === "object" && "name" in holder) {
		const name = (holder as { name?: unknown }).name
		if (typeof name === "string") return name
	}
	return ""
}
