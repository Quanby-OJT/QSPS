import { SetMetadata } from "@nestjs/common"

/** Metadata key read by `SessionAuthGuard` (AUTH-3). */
export const ALLOW_WITHOUT_PASSWORD_CHANGE_KEY = "QSPS_ALLOW_WITHOUT_PASSWORD_CHANGE"

/**
 * AUTH-3: lets an account that must set a new password (`must_reset_password`:
 * staff rotation, or a first sign-in) reach this route. Use only for what the
 * change itself needs. Better Auth's own routes (including `/change-password`)
 * do not pass through Nest guards and need no decorator.
 */
export const AllowWithoutPasswordChange = () => SetMetadata(ALLOW_WITHOUT_PASSWORD_CHANGE_KEY, true)