export { AUTH_CLIENT_ADDRESS_HEADER } from "./client-address.js"
export {
	createAuth,
	getAuth,
	authEnv,
	AUTH_BASE_PATH,
	type Session as AuthSession,
} from "./config.js"
export {
	authSecretSchema,
	isPlaceholderSecret,
	AUTH_SECRET_MIN_LENGTH,
	PLACEHOLDER_SECRET_PREFIXES,
} from "./secret-schema.js"
export { parseOriginList } from "./origin-list.js"
export { setAuthRateLimitStorage, type AuthRateLimitStorage } from "./rate-limit-storage.js"
export type { Session, User, Account, Verification } from "better-auth/types"
export { setAuthEventListener, type AuthEvent, type AuthEventListener } from "./auth-events.js"
export { setLockoutStore, type LockoutStore } from "./lockout-store.js"
export { setAuthPolicyReader, type AuthPolicies, type AuthPolicyReader } from "./auth-policies.js"
export { CAPTCHA_HEADER } from "./captcha.js"
export { sendMail, type MailMessage } from "./mailer/send-mail.js"
export { createTransport } from "./mailer/transport-factory.js"
