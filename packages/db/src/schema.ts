import { defineRelations, sql } from "drizzle-orm"
import { index, primaryKey, uniqueIndex } from "drizzle-orm/pg-core"

import { createTable } from "./utils/table.js"

// ============================================================================
// BETTER AUTH TABLES
// ============================================================================

export const users = createTable("users", t => ({
	id: t.text("id").primaryKey(),
	name: t.text("name").notNull(),
	email: t.text("email").notNull().unique(),
	emailVerified: t.boolean("email_verified").default(false).notNull(),
	image: t.text("image"),
	createdAt: t.timestamp("created_at").notNull().defaultNow(),
	updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
	// QSPS (AUTH-1). All nullable except account_type, so existing rows stay valid.
	/** `client` (registered member of the public) or `staff` (BOQ employee). */
	accountType: t.text("account_type").notNull().default("client"),
	mobile: t.text("mobile"),
	mobileVerifiedAt: t.timestamp("mobile_verified_at", { withTimezone: true }),
	smsNotificationsEnabled: t.boolean("sms_notifications_enabled").notNull().default(false),
	mfaOtpChannel: t.text("mfa_otp_channel").notNull().default("email").$type<"email" | "sms">(),
	birthDate: t.date("birth_date"),
	nationality: t.text("nationality"),
	/** Free text: TOR §VIII.2 requires the field to accept all genders. */
	gender: t.text("gender"),
	/** Set when the client finishes the first-sign-in profile; null blocks the portal. */
	profileCompletedAt: t.timestamp("profile_completed_at"),
	/** Data Privacy Act consent: which notice version was accepted, and when. */
	privacyNoticeVersion: t.text("privacy_notice_version"),
	privacyAcceptedAt: t.timestamp("privacy_accepted_at"),
	// QSPS (ADM-1). Staff invitation & lifecycle columns.
	mustResetPassword: t.boolean("must_reset_password").notNull().default(false),
	disabledAt: t.timestamp("disabled_at"),
	deletedAt: t.timestamp("deleted_at"),
	/** AUTH-2: true once the user has enrolled a second factor (Better Auth two-factor plugin). */
	twoFactorEnabled: t.boolean("two_factor_enabled").notNull().default(false),
	/**
	 * AUTH-3: when the password was last set or changed. Null means unchanged
	 * since `created_at`. Staff passwords older than the rotation Policy must be
	 * changed at sign-in.
	 */
	passwordChangedAt: t.timestamp("password_changed_at"),
}))

export const sessions = createTable("sessions", t => ({
	id: t.text("id").primaryKey(),
	token: t.text("token").notNull().unique(),
	userId: t
		.text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	expiresAt: t.timestamp("expires_at").notNull(),
	ipAddress: t.text("ip_address"),
	userAgent: t.text("user_agent"),
	createdAt: t.timestamp("created_at").notNull().defaultNow(),
	updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
}))

export const accounts = createTable(
	"accounts",
	t => ({
		id: t.text("id"),
		accountId: t.text("account_id").notNull(),
		providerId: t.text("provider_id").notNull(),
		userId: t
			.text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		accessToken: t.text("access_token"),
		refreshToken: t.text("refresh_token"),
		idToken: t.text("id_token"),
		accessTokenExpiresAt: t.timestamp("access_token_expires_at"),
		refreshTokenExpiresAt: t.timestamp("refresh_token_expires_at"),
		scope: t.text("scope"),
		password: t.text("password"), // For email/password auth
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
		updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
	}),
	t => [
		// Composite primary key on provider and account
		primaryKey({ columns: [t.providerId, t.accountId] }),
		index("account_user_id_idx").on(t.userId),
	]
)

export const verifications = createTable(
	"verifications",
	t => ({
		id: t.text("id"),
		identifier: t.text("identifier").notNull(),
		value: t.text("value").notNull(),
		expiresAt: t.timestamp("expires_at").notNull(),
		createdAt: t.timestamp("created_at").defaultNow(),
		updatedAt: t.timestamp("updated_at").defaultNow(),
	}),
	t => [
		// Composite primary key on identifier and value
		primaryKey({ columns: [t.identifier, t.value] }),
		// Rows here are short-lived tokens, but nothing deleted them,
		// so the table only ever grew — every unverified signup and every password
		// reset, kept forever. The sweeper deletes by expiry; without this index it
		// seq-scans a table whose whole problem is that it is large.
		index("verifications_expires_at_idx").on(t.expiresAt),
	]
)

/**
 * Second-factor secrets for the Better Auth two-factor plugin (AUTH-2).
 *
 * One row per enrolled user: the authenticator (TOTP) secret and the
 * recovery codes, both stored encrypted by Better Auth. The plugin locks the
 * challenge after repeated wrong codes using `failed_verification_count` and
 * `locked_until`. Only Better Auth writes this table; columns follow
 * `packages/auth/auth-schema.generated.ts`.
 */
export const twoFactors = createTable(
	"two_factors",
	t => ({
		id: t.text("id").primaryKey(),
		secret: t.text("secret").notNull(),
		backupCodes: t.text("backup_codes").notNull(),
		userId: t
			.text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		verified: t.boolean("verified").default(true),
		failedVerificationCount: t.integer("failed_verification_count").default(0),
		lockedUntil: t.timestamp("locked_until"),
	}),
	t => [index("two_factors_secret_idx").on(t.secret), index("two_factors_user_id_idx").on(t.userId)]
)

/**
 * Hashes of the passwords a staff account has set (AUTH-3, TOR §II / COA
 * Circular 2021-014). A new staff password must differ from the newest five.
 * Insert-only from the auth package; the five newest rows per user are kept.
 * Hashes only, in Better Auth's own format, and never returned by any API.
 */
export const passwordHistory = createTable(
	"password_history",
	t => ({
		id: t.serial("id").primaryKey(),
		userId: t
			.text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		passwordHash: t.text("password_hash").notNull(),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
	}),
	t => [index("password_history_user_created_idx").on(t.userId, t.createdAt)]
)

// ============================================================================
// IDEMPOTENCY KEYS
// ============================================================================

/**
 * Replay cache for mutating requests.
 *
 * The primary key is composite on `(authorId, key)`. It used to be `key`
 * alone, which made the keyspace global: whoever sent a value first owned it,
 * so one user could squat another's key and the second user's request was
 * rejected as a duplicate — a denial-of-service against any client using
 * predictable keys. Idempotency is identity-scoped by design; two users
 * sending the same key are sending two unrelated requests.
 *
 * This is a cache, not a record. Rows expire and are swept.
 */
export const idempotencyKeys = createTable(
	"idempotency_keys",
	t => ({
		key: t.text("key").notNull(),
		authorId: t.text("author_id").notNull(),
		response: t.jsonb("response").notNull().$type<unknown>(),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
		/** When this row stops being a valid replay target. */
		expiresAt: t.timestamp("expires_at").notNull(),
	}),
	t => [
		primaryKey({ columns: [t.authorId, t.key] }),
		// The sweeper deletes by expiry; without this it seq-scans the table.
		index("idempotency_keys_expires_at_idx").on(t.expiresAt),
	]
)

// ============================================================================
// RBAC
// ============================================================================

export const roles = createTable("roles", t => ({
	id: t.serial("id").primaryKey(),
	name: t.text("name").notNull().unique(),
	description: t.text("description"),
	createdAt: t.timestamp("created_at").notNull().defaultNow(),
	updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
}))

export const permissions = createTable("permissions", t => ({
	id: t.serial("id").primaryKey(),
	name: t.text("name").notNull().unique(),
	description: t.text("description"),
	createdAt: t.timestamp("created_at").notNull().defaultNow(),
	updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
}))

export const userRoles = createTable(
	"user_roles",
	t => ({
		userId: t
			.text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		roleId: t
			.integer("role_id")
			.notNull()
			.references(() => roles.id, { onDelete: "cascade" }),
	}),
	t => [primaryKey({ columns: [t.userId, t.roleId] }), index("user_roles_user_id_idx").on(t.userId)]
)

export const rolePermissions = createTable(
	"role_permissions",
	t => ({
		roleId: t
			.integer("role_id")
			.notNull()
			.references(() => roles.id, { onDelete: "cascade" }),
		permissionId: t
			.integer("permission_id")
			.notNull()
			.references(() => permissions.id, { onDelete: "cascade" }),
	}),
	t => [primaryKey({ columns: [t.roleId, t.permissionId] })]
)

// ============================================================================
// AUDIT LOG
// ============================================================================

/**
 * Append-only record of user and System actions (FND-3, TOR §VIII.1).
 *
 * Rows are written **in the same transaction** as the mutation they describe,
 * so a failed insert rolls the mutation back and the log can never disagree
 * with the data. Only `AuditService.record` inserts here (DOMAIN-MODEL §6).
 *
 * Tamper resistance:
 * - A database trigger rejects UPDATE, DELETE and TRUNCATE for every role,
 *   administrators included (migration `audit_log_append_only`).
 * - Each row stores `entry_hash = sha256(prev_hash + this row)`, chaining it to
 *   the row before. `pnpm audit:verify` recomputes the chain and reports the
 *   first row changed outside the application. Rows written before FND-3 have
 *   no hash and are reported as before the chain started.
 *
 * `actorId` stays `set null`, but users are never hard-deleted (DOMAIN-MODEL
 * §4): with the trigger in place, deleting a user who has audit entries fails,
 * which is the intended protection.
 */
export const auditLog = createTable(
	"audit_log",
	t => ({
		id: t.serial("id").primaryKey(),
		/** Broad area the event belongs to, e.g. "rbac", or the job name for System actions. */
		domain: t.text("domain").notNull(),
		/** What happened, e.g. "role.assign", "role.remove", "role.create". */
		action: t.text("action").notNull(),
		/** Whether the attempt succeeded or was refused. A denial is evidence. */
		outcome: t.text("outcome").notNull().default("success").$type<"success" | "denied">(),
		/** Who acted. Null only for System actions. */
		actorId: t.text("actor_id").references(() => users.id, { onDelete: "set null" }),
		/** The actor's role names at that moment, e.g. "Cashier, Processing Officer". Null for System. */
		actorRole: t.text("actor_role"),
		/** Kind of thing acted on, e.g. "user", "role". */
		targetType: t.text("target_type"),
		/** Identifier of the thing acted on, as text so any key type fits. */
		targetId: t.text("target_id"),
		/** State before and after, plus any denial reason. Shape is per-action. */
		oldValue: t.jsonb("old_value").$type<unknown>(),
		newValue: t.jsonb("new_value").$type<unknown>(),
		reason: t.text("reason"),
		/** Client address, resolved with the same trusted-proxy rule as the rate limiter. Null for System. */
		ipAddress: t.text("ip_address"),
		/** Client User-Agent header, capped in length. Null for System. */
		userAgent: t.text("user_agent"),
		/** `entry_hash` of the row before this one; null for the first chained row. */
		prevHash: t.text("prev_hash"),
		/** sha256 (hex) of `prev_hash` plus this row's fields. Null only for rows from before FND-3. */
		entryHash: t.text("entry_hash"),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
	}),
	t => [
		// The read endpoint is strictly reverse-chronological.
		index("audit_log_created_at_idx").on(t.createdAt),
		index("audit_log_actor_id_idx").on(t.actorId),
		// ADM-3 filters. Each ends in id so "newest first" reads the index in order.
		index("audit_log_domain_action_idx").on(t.domain, t.action, t.id),
		index("audit_log_target_idx").on(t.targetType, t.targetId, t.id),
		// Denials are few and often searched for; successes are not indexed.
		index("audit_log_denied_idx")
			.on(t.id)
			.where(sql`${t.outcome} = 'denied'`),
	]
)

// ============================================================================
// LOCATIONS
// ============================================================================

export const locations = createTable("locations", t => ({
	id: t.serial("id").primaryKey(),
	code: t.text("code").notNull().unique(),
	name: t.text("name").notNull(),
	address: t.text("address").notNull(),
	region: t.text("region").notNull(),
	isActive: t.boolean("is_active").notNull().default(true),
	createdAt: t.timestamp("created_at").notNull().defaultNow(),
	updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
}))

// ============================================================================
// SERVICES
// ============================================================================

export const serviceCategories = createTable("service_categories", t => ({
	id: t.serial("id").primaryKey(),
	code: t.text("code").notNull().unique(),
	name: t.text("name").notNull(),
}))

export const services = createTable(
	"services",
	t => ({
		id: t.serial("id").primaryKey(),
		serviceCategoryId: t
			.integer("service_category_id")
			.notNull()
			.references(() => serviceCategories.id, { onDelete: "restrict" }),
		/** Stable identifier, unique across all services, stored uppercase (same rule as location codes). */
		code: t.text("code").notNull().unique(),
		name: t.text("name").notNull(),
		/** Integer centavos. Fee changes apply to new Bookings only. */
		feeCentavos: t.integer("fee_centavos").notNull(),
		/** Whether a Booking for this service needs head approval. */
		requiresApproval: t.boolean("requires_approval").notNull().default(false),
		/** Document issued when a booking item is cleared (CRT-1); null when the service issues none. */
		documentType: t.text("document_type"),
		/**
		 * Issue the document as soon as a Booking Item is cleared (CRT-1). On by
		 * default; when off, staff issue it as a separate step.
		 */
		autoIssue: t.boolean("auto_issue").notNull().default(true),
		isActive: t.boolean("is_active").notNull().default(true),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
		updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
	}),
	t => [
		uniqueIndex("services_category_name_idx").on(t.serviceCategoryId, t.name),
		index("services_category_active_idx").on(t.serviceCategoryId, t.isActive),
	]
)

// ============================================================================
// USER SCOPES
// ============================================================================

/**
 * The Service Categories and Locations a staff user may act on
 * (DOMAIN-MODEL.md section 4). A null column means "all"; no rows means no
 * scoped access. PRC-1 reads the Location from here; ADM-2 adds the admin
 * screen and `ScopeService` on top of this table.
 */
export const userScopes = createTable(
	"user_scopes",
	t => ({
		id: t.serial("id").primaryKey(),
		userId: t
			.text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		serviceCategoryId: t
			.integer("service_category_id")
			.references(() => serviceCategories.id, { onDelete: "restrict" }),
		locationId: t.integer("location_id").references(() => locations.id, { onDelete: "restrict" }),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
		updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
	}),
	t => [index("user_scopes_user_idx").on(t.userId)]
)

// ============================================================================
// SCHEDULES
// ============================================================================

/**
 * Capacity for one Service at one Location on one date and time window (SCH-1).
 *
 * `starts_at` and `ends_at` are UTC; the Asia/Manila date and time the admin
 * typed are converted at the edge. `booked_count` is created here but changed
 * only by `BookingService`, with a row lock (DOMAIN-MODEL.md section 6).
 */
export const scheduleSlots = createTable(
	"schedule_slots",
	t => ({
		id: t.serial("id").primaryKey(),
		serviceId: t
			.integer("service_id")
			.notNull()
			.references(() => services.id, { onDelete: "restrict" }),
		locationId: t
			.integer("location_id")
			.notNull()
			.references(() => locations.id, { onDelete: "restrict" }),
		startsAt: t.timestamp("starts_at").notNull(),
		endsAt: t.timestamp("ends_at").notNull(),
		capacity: t.integer("capacity").notNull(),
		bookedCount: t.integer("booked_count").notNull().default(0),
		/** A disabled slot takes no new bookings; existing bookings stay. */
		isDisabled: t.boolean("is_disabled").notNull().default(false),
		/** SCH-2: reason recorded when a date is blocked. */
		disabledReason: t.text("disabled_reason"),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
		updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
	}),
	t => [
		// One slot per service, location and start time: generating the same
		// range twice skips what already exists.
		uniqueIndex("schedule_slots_service_location_start_idx").on(
			t.serviceId,
			t.locationId,
			t.startsAt
		),
		index("schedule_slots_location_start_idx").on(t.locationId, t.startsAt),
	]
)

// ============================================================================
// BOOKINGS
// ============================================================================

/**
 * A client's reservation (BKG-1). Status follows state machine 5.1 in
 * DOMAIN-MODEL.md and is changed only by `BookingService`. Money is integer
 * centavos; timestamps are UTC.
 */
export const bookings = createTable(
	"bookings",
	t => ({
		id: t.serial("id").primaryKey(),
		/** Shown to the client and encoded in the QR code: QSPS-YYMMDD-XXXXXX. */
		referenceNumber: t.text("reference_number").notNull().unique(),
		clientId: t
			.text("client_id")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		status: t
			.text("status")
			.notNull()
			.$type<
				| "pending_approval"
				| "pending_payment"
				| "paid"
				| "completed"
				| "cancelled"
				| "rejected"
				| "forfeited"
				| "refund_requested"
				| "refunded"
			>(),
		kind: t
			.text("kind")
			.notNull()
			.default("regular")
			.$type<"regular" | "expedite" | "vip" | "walk-in">(),
		totalCentavos: t.integer("total_centavos").notNull(),
		/** When an unpaid booking stops holding its slot; null once paid or once onsite payment is chosen. */
		holdExpiresAt: t.timestamp("hold_expires_at"),
		/**
		 * BKG-2: the client will pay at the BOQ cashier. The hold no longer
		 * applies; the arrival cutoff (`booking.arrival_cutoff_minutes`) does.
		 */
		payOnsite: t.boolean("pay_onsite").notNull().default(false),
		/** BKG-2: why a cancelled booking was cancelled; null for any other status. */
		cancelReason: t.text("cancel_reason").$type<"hold_expired" | "no_show" | "client_cancelled">(),
		/** BKG-2: when the booking was cancelled; null for any other status. */
		cancelledAt: t.timestamp("cancelled_at"),
		/** Who created it: the client, or staff for VIP and walk-in bookings. */
		createdBy: t
			.text("created_by")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
		updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
	}),
	t => [
		index("bookings_client_status_idx").on(t.clientId, t.status),
		index("bookings_status_hold_idx").on(t.status, t.holdExpiresAt),
	]
)

/** One Service in a Booking, with its own Schedule Slot, fee and processing status (5.2). */
export const bookingItems = createTable(
	"booking_items",
	t => ({
		id: t.serial("id").primaryKey(),
		bookingId: t
			.integer("booking_id")
			.notNull()
			.references(() => bookings.id, { onDelete: "restrict" }),
		serviceId: t
			.integer("service_id")
			.notNull()
			.references(() => services.id, { onDelete: "restrict" }),
		scheduleSlotId: t
			.integer("schedule_slot_id")
			.notNull()
			.references(() => scheduleSlots.id, { onDelete: "restrict" }),
		locationId: t
			.integer("location_id")
			.notNull()
			.references(() => locations.id, { onDelete: "restrict" }),
		/** The service fee when booked; later fee changes do not alter it. */
		feeCentavos: t.integer("fee_centavos").notNull(),
		status: t
			.text("status")
			.notNull()
			.default("booked")
			.$type<
				| "booked"
				| "checked_in"
				| "in_assessment"
				| "returned"
				| "cleared"
				| "pending_head_approval"
				| "issued"
				| "rejected"
				| "no_show"
			>(),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
		updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
	}),
	t => [
		index("booking_items_booking_idx").on(t.bookingId),
		index("booking_items_slot_idx").on(t.scheduleSlotId),
	]
)

// ============================================================================
// PROCESSING (PRC-1)
// ============================================================================

/**
 * One staff verification of one Booking Item (PRC-1): cleared, returned for
 * correction, or rejected. Insert-only history; the item's current status
 * lives on `booking_items` and only `BookingService` changes it. Staff
 * corrections go here because Form Submissions are immutable after payment.
 */
export const assessments = createTable(
	"assessments",
	t => ({
		id: t.serial("id").primaryKey(),
		bookingItemId: t
			.integer("booking_item_id")
			.notNull()
			.references(() => bookingItems.id, { onDelete: "restrict" }),
		staffId: t
			.text("staff_id")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		outcome: t.text("outcome").notNull().$type<"cleared" | "returned" | "rejected">(),
		/**
		 * Who decided (PRC-3): `assessment` by the Processing Officer, `approval`
		 * by the head approving (`cleared`) or sending back (`returned`) a
		 * `pending_head_approval` item, `override` by the head clearing a
		 * rejected item. `notes` holds the override reason.
		 */
		kind: t
			.text("kind")
			.notNull()
			.default("assessment")
			.$type<"assessment" | "approval" | "override">(),
		notes: t.text("notes"),
		/** Field name to corrected value, as recorded by staff. */
		corrections: t.jsonb("corrections").$type<Record<string, string>>().notNull().default({}),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
	}),
	t => [index("assessments_booking_item_idx").on(t.bookingItemId, t.createdAt)]
)

// ============================================================================
// CERTIFICATES (CRT-1)
// ============================================================================

/**
 * An official document issued for a cleared Booking Item (CRT-1, Flow D):
 * certificate, permit or vaccination record. Never deleted. Created only by
 * `DocumentService.issue`, inside the transaction that marks the item
 * `issued`. The PDF is rendered on demand from `payload`, never stored.
 *
 * Columns from DOMAIN-MODEL.md section 4. `superseded_by`, `revoked_reason`,
 * `print_count` and `legacy_id` are added by the tickets that use them
 * (CRT-8, CRT-3, MIG-4).
 */
export const documents = createTable(
	"documents",
	t => ({
		id: t.serial("id").primaryKey(),
		/** Null only for documents imported from the legacy system (MIG-4). */
		bookingItemId: t
			.integer("booking_item_id")
			.references(() => bookingItems.id, { onDelete: "restrict" }),
		/** A key in the document-type registry, e.g. "icv-record". */
		documentType: t.text("document_type").notNull(),
		/** e.g. ICV-MNL-2026-000001. Unique per document type. */
		documentNumber: t.text("document_number").notNull(),
		/** 128 random bits, base64url. Encoded in the QR code; the public lookup key (CRT-2). */
		verificationToken: t.text("verification_token").notNull().unique(),
		issuingLocationId: t
			.integer("issuing_location_id")
			.notNull()
			.references(() => locations.id, { onDelete: "restrict" }),
		/** The officer who issued it (for auto-issue, the officer who cleared the item). */
		issuedBy: t.text("issued_by").references(() => users.id, { onDelete: "restrict" }),
		issuedAt: t.timestamp("issued_at").notNull().defaultNow(),
		/** Last valid day; null means it does not expire. */
		validUntil: t.date("valid_until"),
		status: t.text("status").notNull().default("valid").$type<"valid" | "revoked" | "superseded">(),
		source: t.text("source").notNull().default("qsps").$type<"qsps" | "legacy">(),
		/** Everything printed on the document, copied at issue time (shape set by the type registry). */
		payload: t.jsonb("payload").notNull().$type<Record<string, unknown>>(),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
		updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
	}),
	t => [
		uniqueIndex("documents_type_number_uq").on(t.documentType, t.documentNumber),
		// At most one valid document per Booking Item: issuing twice can never
		// create a second one. A reissue (CRT-8) supersedes the old row first.
		uniqueIndex("documents_booking_item_valid_uq")
			.on(t.bookingItemId)
			.where(sql`${t.status} = 'valid'`),
		index("documents_issuing_location_idx").on(t.issuingLocationId),
	]
)

/**
 * The next Document Number for each document type at each Location (CRT-1).
 * Read and incremented with a row lock inside the issuing transaction, so a
 * number is never used twice. The counter never resets; the year in the
 * number is only the issue year.
 */
export const documentSequences = createTable(
	"document_sequences",
	t => ({
		id: t.serial("id").primaryKey(),
		documentType: t.text("document_type").notNull(),
		locationId: t
			.integer("location_id")
			.notNull()
			.references(() => locations.id, { onDelete: "restrict" }),
		nextNumber: t.integer("next_number").notNull().default(1),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
		updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
	}),
	t => [uniqueIndex("document_sequences_type_location_uq").on(t.documentType, t.locationId)]
)

// ============================================================================
// PAYMENTS (PAY-1)
// ============================================================================

/**
 * The ways a client can pay, and which gateway serves each (PAY-5). Switching
 * a channel to another provider is a row update, with no deployment (PRD
 * decision B2). Seeded with TOR §VIII.2's list, all disabled until an
 * administrator assigns a provider. The convenience fee is a fixed amount
 * plus a percentage of the Service fees (either may be zero); a change
 * applies to new Payments only, because each Payment stores its own fee.
 */
export const paymentChannels = createTable("payment_channels", t => ({
	/** Lowercase code, e.g. "gcash". Stored on every Payment as channel_code. */
	code: t.text("code").primaryKey(),
	name: t.text("name").notNull(),
	/** The PaymentProvider that serves this channel; null until one is assigned. */
	providerCode: t.text("provider_code"),
	convenienceFeeCentavos: t.integer("convenience_fee_centavos").notNull().default(0),
	/** Percentage part of the fee in basis points: 250 = 2.5% of the Service fees. */
	convenienceFeeBps: t.integer("convenience_fee_bps").notNull().default(0),
	isEnabled: t.boolean("is_enabled").notNull().default(false),
	createdAt: t.timestamp("created_at").notNull().defaultNow(),
	updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
}))

/**
 * One attempt to pay a Booking (PAY-1). Status follows state machine 5.3 in
 * DOMAIN-MODEL.md and only `PaymentService` writes this table. Money is
 * integer centavos: `amount_centavos` is the full amount charged (the Booking
 * total plus `convenience_fee_centavos`).
 */
export const payments = createTable(
	"payments",
	t => ({
		id: t.serial("id").primaryKey(),
		bookingId: t
			.integer("booking_id")
			.notNull()
			.references(() => bookings.id, { onDelete: "restrict" }),
		/** What the client picked at checkout. Equals the provider code until PAY-5 adds channels. */
		channelCode: t.text("channel_code").notNull(),
		/** The `PaymentProvider` that handles this payment, e.g. "fake", "linkbiz", "onsite". */
		providerCode: t.text("provider_code").notNull(),
		/** The provider's id for this payment; set once checkout is created. */
		providerReference: t.text("provider_reference"),
		amountCentavos: t.integer("amount_centavos").notNull(),
		convenienceFeeCentavos: t.integer("convenience_fee_centavos").notNull().default(0),
		status: t
			.text("status")
			.notNull()
			.default("initiated")
			.$type<"initiated" | "pending" | "succeeded" | "failed" | "expired" | "refunded">(),
		/** Set when money arrived for a Booking that can no longer be paid (late payment, D7). */
		needsReview: t.boolean("needs_review").notNull().default(false),
		/** The cashier who took an onsite payment; null for online payments. */
		collectedBy: t.text("collected_by").references(() => users.id, { onDelete: "restrict" }),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
		updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
	}),
	t => [
		index("payments_booking_idx").on(t.bookingId),
		// A provider reference identifies one payment. Nulls (not yet sent to
		// checkout) do not collide in Postgres.
		uniqueIndex("payments_provider_reference_uq").on(t.providerCode, t.providerReference),
		// No unique index on "one succeeded per booking": if a client pays twice,
		// the second success is real money and must still be recorded. It is
		// kept with needs_review = true instead (PaymentService.confirm).
	]
)

/**
 * Raw log of every provider notification (PAY-1). Stored before anything is
 * checked, including forged and duplicate ones. Insert-only: the one later
 * write is `processed_at`, set when the event changed a Payment.
 */
export const paymentEvents = createTable(
	"payment_events",
	t => ({
		id: t.serial("id").primaryKey(),
		/** Null when the notification names no payment we know. */
		paymentId: t.integer("payment_id").references(() => payments.id, { onDelete: "restrict" }),
		providerCode: t.text("provider_code").notNull(),
		providerEventId: t.text("provider_event_id").notNull(),
		payload: t.jsonb("payload").notNull().$type<unknown>(),
		signatureValid: t.boolean("signature_valid").notNull(),
		processedAt: t.timestamp("processed_at"),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
	}),
	t => [
		// A redelivered notification hits this and is not processed twice.
		uniqueIndex("payment_events_provider_event_uq").on(t.providerCode, t.providerEventId),
		index("payment_events_payment_idx").on(t.paymentId),
	]
)

/**
 * The e-Receipt for one succeeded Payment (PAY-2). Created once, in the same
 * transaction that marks the Payment `succeeded`; never updated. The PDF is
 * rendered on demand from this row and its Payment, never stored as a file.
 */
export const receipts = createTable("receipts", t => ({
	id: t.serial("id").primaryKey(),
	paymentId: t
		.integer("payment_id")
		.notNull()
		.unique()
		.references(() => payments.id, { onDelete: "restrict" }),
	/** Shown on the receipt: QSPS-R-YYMMDD-NNNNNN (Manila date, payment id). */
	receiptNumber: t.text("receipt_number").notNull().unique(),
	/** 128 random bits, base64url. Encoded in the QR code; the public lookup key. */
	verificationToken: t.text("verification_token").notNull().unique(),
	issuedAt: t.timestamp("issued_at").notNull().defaultNow(),
}))

// ============================================================================
// POLICIES
// ============================================================================

/**
 * Admin-editable rule values (ADM-6). One row per Policy BOQ has changed; a
 * key with no row reads its documented default from the policy registry in
 * `@repo/contracts`. Written only by `PolicyService.set`, which records the
 * old and new value in the audit trail in the same transaction.
 */
export const policies = createTable("policies", t => ({
	id: t.serial("id").primaryKey(),
	key: t.text("key").notNull().unique(),
	value: t.jsonb("value").$type<unknown>().notNull(),
	/** Who last changed it. Null only for a row written by the System. */
	updatedBy: t.text("updated_by").references(() => users.id, { onDelete: "set null" }),
	createdAt: t.timestamp("created_at").notNull().defaultNow(),
	updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
}))

// ============================================================================
// POLICY DOCUMENTS (ADM-9)
// ============================================================================

/**
 * A written policy clients read, and may have to accept, at booking (ADM-9,
 * assumption A1). One row per version: all versions of a policy share
 * `document_key`, and editing writes the next `version` instead of changing a
 * row, so an acceptance always points at the exact text the client saw. Only
 * `withdrawn_at` is ever updated. Written only by `PolicyDocumentService`.
 */
export const policyDocuments = createTable(
	"policy_documents",
	t => ({
		id: t.serial("id").primaryKey(),
		/** Random key shared by every version of one policy. */
		documentKey: t.text("document_key").notNull(),
		/** 1 for the first version, then 2, 3… */
		version: t.integer("version").notNull(),
		title: t.text("title").notNull(),
		/** Plain text; shown as paragraphs, never as HTML. */
		body: t.text("body").notNull(),
		appliesToAllServices: t.boolean("applies_to_all_services").notNull().default(false),
		/** The Services it applies to; empty when it applies to all. */
		serviceIds: t
			.integer("service_ids")
			.array()
			.notNull()
			.default(sql`'{}'::integer[]`),
		/** First Manila date the version applies to bookings. */
		effectiveFrom: t.date("effective_from").notNull(),
		requiresAcceptance: t.boolean("requires_acceptance").notNull().default(true),
		/** Set on every version of the key when the policy is withdrawn. */
		withdrawnAt: t.timestamp("withdrawn_at"),
		createdBy: t
			.text("created_by")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
	}),
	t => [
		uniqueIndex("policy_documents_key_version_uq").on(t.documentKey, t.version),
		index("policy_documents_effective_idx").on(t.effectiveFrom),
	]
)

/**
 * A client's acceptance of one policy version for one Booking (ADM-9).
 * Insert-only; written by `BookingService.create` in the booking transaction.
 */
export const policyAcceptances = createTable(
	"policy_acceptances",
	t => ({
		id: t.serial("id").primaryKey(),
		bookingId: t
			.integer("booking_id")
			.notNull()
			.references(() => bookings.id, { onDelete: "restrict" }),
		/** The exact version accepted. */
		policyDocumentId: t
			.integer("policy_document_id")
			.notNull()
			.references(() => policyDocuments.id, { onDelete: "restrict" }),
		clientId: t
			.text("client_id")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		acceptedAt: t.timestamp("accepted_at").notNull().defaultNow(),
	}),
	t => [
		uniqueIndex("policy_acceptances_booking_document_uq").on(t.bookingId, t.policyDocumentId),
		index("policy_acceptances_document_idx").on(t.policyDocumentId),
	]
)

// NTF-2: persist send limits across instances; the key is a keyed digest.
export const smsCodeLimits = createTable("sms_code_limits", t => ({
	key: t.text("key").primaryKey(),
	windowStartedAt: t.timestamp("window_started_at", { withTimezone: true }).notNull(),
	count: t.integer("count").notNull().default(0),
}))

export const mobileVerificationChallenges = createTable("mobile_verification_challenges", t => ({
	userId: t
		.text("user_id")
		.primaryKey()
		.references(() => users.id, { onDelete: "cascade" }),
	mobile: t.text("mobile").notNull(),
	codeDigest: t.text("code_digest").notNull(),
	expiresAt: t.timestamp("expires_at", { withTimezone: true }).notNull(),
	failedAttempts: t.integer("failed_attempts").notNull().default(0),
}))

export const notifications = createTable(
	"notifications",
	t => ({
		id: t.serial("id").primaryKey(),
		userId: t
			.text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		channel: t.text("channel").notNull().$type<"email" | "sms" | "push">(),
		template: t.text("template").notNull(),
		payload: t.jsonb("payload").notNull().$type<Record<string, unknown>>(),
		status: t.text("status").notNull().default("queued").$type<"queued" | "sent" | "failed">(),
		attempts: t.integer("attempts").notNull().default(0),
		dedupeKey: t.text("dedupe_key").notNull().unique(),
		nextAttemptAt: t.timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
	}),
	t => [index("notifications_due_idx").on(t.channel, t.status, t.nextAttemptAt)]
)

// ============================================================================
// FORMS (FRM-1)
// ============================================================================

/** Field types a questionnaire supports. Same list as FORM_FIELD_TYPES in @repo/contracts. */
export type FormFieldType =
	| "text"
	| "number"
	| "date"
	| "single_choice"
	| "multiple_choice"
	| "yes_no"
	| "file"

/**
 * One version of the questionnaire a client answers for a Service (FRM-1).
 *
 * A Service has at most one `draft` and one `published` version at a time;
 * publishing retires the previous published version, which is kept so older
 * Form Submissions still display against the fields they answered. A
 * published version is never edited: changing it creates the next version
 * as a draft. `is_active` disables or re-enables a version without deleting
 * it (the fallback when a template with submissions cannot be deleted).
 */
export const formTemplates = createTable(
	"form_templates",
	t => ({
		id: t.serial("id").primaryKey(),
		serviceId: t
			.integer("service_id")
			.notNull()
			.references(() => services.id, { onDelete: "restrict" }),
		/** 1, 2, 3… per Service, in the order versions were created. */
		version: t.integer("version").notNull(),
		status: t.text("status").notNull().default("draft").$type<"draft" | "published" | "retired">(),
		isActive: t.boolean("is_active").notNull().default(true),
		publishedAt: t.timestamp("published_at"),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
		updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
	}),
	t => [
		uniqueIndex("form_templates_service_version_uq").on(t.serviceId, t.version),
		// At most one draft and one published version per Service.
		uniqueIndex("form_templates_one_draft_per_service_uq")
			.on(t.serviceId)
			.where(sql`${t.status} = 'draft'`),
		uniqueIndex("form_templates_one_published_per_service_uq")
			.on(t.serviceId)
			.where(sql`${t.status} = 'published'`),
	]
)

/** One question in a Form Template version. Replaced as a whole while the version is a draft. */
export const formFields = createTable(
	"form_fields",
	t => ({
		id: t.serial("id").primaryKey(),
		formTemplateId: t
			.integer("form_template_id")
			.notNull()
			.references(() => formTemplates.id, { onDelete: "cascade" }),
		type: t.text("type").notNull().$type<FormFieldType>(),
		label: t.text("label").notNull(),
		required: t.boolean("required").notNull().default(false),
		/** The choices for single_choice and multiple_choice fields; null for every other type. */
		options: t.jsonb("options").$type<string[] | null>(),
		/** 0-based order within the version. */
		position: t.integer("position").notNull(),
	}),
	t => [uniqueIndex("form_fields_template_position_uq").on(t.formTemplateId, t.position)]
)

/**
 * A client's answers to one Form Template version for one Booking Item.
 * Filled by FRM-2; created here because FRM-1's versioning and delete rules
 * depend on whether a version has submissions. Points at the exact version
 * answered, so an edited form never changes how old answers display.
 */
export const formSubmissions = createTable(
	"form_submissions",
	t => ({
		id: t.serial("id").primaryKey(),
		bookingItemId: t
			.integer("booking_item_id")
			.notNull()
			.references(() => bookingItems.id, { onDelete: "restrict" }),
		formTemplateId: t
			.integer("form_template_id")
			.notNull()
			.references(() => formTemplates.id, { onDelete: "restrict" }),
		answers: t.jsonb("answers").notNull().$type<Record<string, unknown>>(),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
	}),
	t => [
		index("form_submissions_template_idx").on(t.formTemplateId),
		// One answer set per Booking Item; FRM-2 writes it.
		uniqueIndex("form_submissions_booking_item_uq").on(t.bookingItemId),
	]
)

// ============================================================================
// RELATIONS
// ============================================================================
export const relations = defineRelations(
	{
		users,
		sessions,
		accounts,
		twoFactors,
		passwordHistory,
		idempotencyKeys,
		roles,
		permissions,
		userRoles,
		rolePermissions,
		auditLog,
		locations,
		serviceCategories,
		services,
		scheduleSlots,
		bookings,
		bookingItems,
		paymentChannels,
		payments,
		paymentEvents,
		assessments,
		receipts,
		userScopes,
		documents,
		documentSequences,
		policies,
		policyDocuments,
		policyAcceptances,
		notifications,
		smsCodeLimits,
		mobileVerificationChallenges,
		formTemplates,
		formFields,
		formSubmissions,
	},
	r => ({
		users: {
			sessions: r.many.sessions(),
			accounts: r.many.accounts(),
			twoFactors: r.many.twoFactors(),
			passwordHistory: r.many.passwordHistory(),
			userRoles: r.many.userRoles(),
			userScopes: r.many.userScopes(),
		},
		sessions: {
			user: r.one.users({
				from: r.sessions.userId,
				to: r.users.id,
			}),
		},
		accounts: {
			user: r.one.users({
				from: r.accounts.userId,
				to: r.users.id,
			}),
		},
		twoFactors: {
			user: r.one.users({
				from: r.twoFactors.userId,
				to: r.users.id,
			}),
		},
		passwordHistory: {
			user: r.one.users({
				from: r.passwordHistory.userId,
				to: r.users.id,
			}),
		},
		roles: {
			userRoles: r.many.userRoles(),
			rolePermissions: r.many.rolePermissions(),
		},
		permissions: {
			rolePermissions: r.many.rolePermissions(),
		},
		auditLog: {
			actor: r.one.users({
				from: r.auditLog.actorId,
				to: r.users.id,
			}),
		},
		locations: {
			scheduleSlots: r.many.scheduleSlots(),
		},
		serviceCategories: {
			services: r.many.services(),
		},
		services: {
			category: r.one.serviceCategories({
				from: r.services.serviceCategoryId,
				to: r.serviceCategories.id,
			}),
			scheduleSlots: r.many.scheduleSlots(),
		},
		bookings: {
			client: r.one.users({
				from: r.bookings.clientId,
				to: r.users.id,
			}),
			items: r.many.bookingItems(),
			payments: r.many.payments(),
		},
		payments: {
			booking: r.one.bookings({
				from: r.payments.bookingId,
				to: r.bookings.id,
			}),
			events: r.many.paymentEvents(),
			receipt: r.one.receipts({
				from: r.payments.id,
				to: r.receipts.paymentId,
			}),
		},
		receipts: {
			payment: r.one.payments({
				from: r.receipts.paymentId,
				to: r.payments.id,
			}),
		},
		paymentEvents: {
			payment: r.one.payments({
				from: r.paymentEvents.paymentId,
				to: r.payments.id,
			}),
		},
		bookingItems: {
			booking: r.one.bookings({
				from: r.bookingItems.bookingId,
				to: r.bookings.id,
			}),
			service: r.one.services({
				from: r.bookingItems.serviceId,
				to: r.services.id,
			}),
			scheduleSlot: r.one.scheduleSlots({
				from: r.bookingItems.scheduleSlotId,
				to: r.scheduleSlots.id,
			}),
			location: r.one.locations({
				from: r.bookingItems.locationId,
				to: r.locations.id,
			}),
			assessments: r.many.assessments(),
			documents: r.many.documents(),
		},
		documents: {
			bookingItem: r.one.bookingItems({
				from: r.documents.bookingItemId,
				to: r.bookingItems.id,
			}),
			issuingLocation: r.one.locations({
				from: r.documents.issuingLocationId,
				to: r.locations.id,
			}),
			issuer: r.one.users({
				from: r.documents.issuedBy,
				to: r.users.id,
			}),
		},
		assessments: {
			bookingItem: r.one.bookingItems({
				from: r.assessments.bookingItemId,
				to: r.bookingItems.id,
			}),
			staff: r.one.users({
				from: r.assessments.staffId,
				to: r.users.id,
			}),
		},
		scheduleSlots: {
			service: r.one.services({
				from: r.scheduleSlots.serviceId,
				to: r.services.id,
			}),
			location: r.one.locations({
				from: r.scheduleSlots.locationId,
				to: r.locations.id,
			}),
		},
		userScopes: {
			user: r.one.users({
				from: r.userScopes.userId,
				to: r.users.id,
			}),
			location: r.one.locations({
				from: r.userScopes.locationId,
				to: r.locations.id,
			}),
			serviceCategory: r.one.serviceCategories({
				from: r.userScopes.serviceCategoryId,
				to: r.serviceCategories.id,
			}),
		},
		policyDocuments: {
			acceptances: r.many.policyAcceptances(),
			creator: r.one.users({
				from: r.policyDocuments.createdBy,
				to: r.users.id,
			}),
		},
		policyAcceptances: {
			booking: r.one.bookings({
				from: r.policyAcceptances.bookingId,
				to: r.bookings.id,
			}),
			policyDocument: r.one.policyDocuments({
				from: r.policyAcceptances.policyDocumentId,
				to: r.policyDocuments.id,
			}),
			client: r.one.users({
				from: r.policyAcceptances.clientId,
				to: r.users.id,
			}),
		},
		userRoles: {
			user: r.one.users({
				from: r.userRoles.userId,
				to: r.users.id,
			}),
			role: r.one.roles({
				from: r.userRoles.roleId,
				to: r.roles.id,
			}),
		},
		rolePermissions: {
			role: r.one.roles({
				from: r.rolePermissions.roleId,
				to: r.roles.id,
			}),
			permission: r.one.permissions({
				from: r.rolePermissions.permissionId,
				to: r.permissions.id,
			}),
		},
	})
)

// ============================================================================
// SCHEMA
// ============================================================================
export const schema = Object.assign(
	{
		users,
		sessions,
		accounts,
		verifications,
		twoFactors,
		passwordHistory,
		idempotencyKeys,
		roles,
		permissions,
		userRoles,
		rolePermissions,
		locations,
		serviceCategories,
		services,
		scheduleSlots,
		bookings,
		bookingItems,
		paymentChannels,
		payments,
		paymentEvents,
		assessments,
		receipts,
		userScopes,
		documents,
		documentSequences,
		policies,
		policyDocuments,
		policyAcceptances,
		notifications,
		smsCodeLimits,
		mobileVerificationChallenges,
		formTemplates,
		formFields,
		formSubmissions,
	},
	relations
)
