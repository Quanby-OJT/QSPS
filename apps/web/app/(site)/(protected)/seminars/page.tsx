import type { Metadata } from "next"

import { SeminarSessions } from "@/features/certificates/components/seminar-sessions"

export const metadata: Metadata = {
	title: "Seminars",
	description: "Mark seminar attendance and issue Food Safety Training Certificates.",
}

/** Seminar sessions for staff (CRT-6). Sign-in comes from the protected layout; the API checks the permission and Scope. */
export default function SeminarsPage() {
	return <SeminarSessions />
}
