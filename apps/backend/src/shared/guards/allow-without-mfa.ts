import { SetMetadata } from "@nestjs/common"

/** Metadata key read by `SessionAuthGuard` (AUTH-2). */
export const ALLOW_WITHOUT_MFA_KEY = "QSPS_ALLOW_WITHOUT_MFA"

/**
 * AUTH-2: lets a signed-in staff account that has not set up two-factor
 * authentication reach this route. Use only for what enrolment itself needs.
 * Better Auth's own `/api/auth/*` routes (including `/two-factor/*`) do not
 * pass through Nest guards and need no decorator.
 */
export const AllowWithoutMfa = () => SetMetadata(ALLOW_WITHOUT_MFA_KEY, true)
