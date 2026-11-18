import { defineRelations } from "drizzle-orm"
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
	birthDate: t.date("birth_date"),
	nationality: t.text("nationality"),
	/** Free text: TOR §VIII.2 requires the field to accept all genders. */
	gender: t.text("gender"),
	/** Set when the client finishes the first-sign-in profile; null blocks the portal. */
	profileCompletedAt: t.timestamp("profile_completed_at"),
	/** Data Privacy Act consent: which notice version was accepted, and when. */
	privacyNoticeVersion: t.text("privacy_notice_version"),
	privacyAcceptedAt: t.timestamp("privacy_accepted_at"),
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
 * Append-only record of privileged mutations.
 *
 * Owned by the `authz` epic. Rows are written **in the same transaction** as
 * the mutation they describe, so a failed insert rolls the mutation back and
 * the log can never disagree with the data. Other domains record events by
 * calling the audit service's helper — never by inserting here directly — so
 * that the append-only rule has exactly one enforcement point.
 *
 * There is deliberately no `updatedAt`: a row that can be updated is not an
 * audit trail. The application exposes no UPDATE or DELETE path to this table.
 *
 * `actorId` is nullable and uses `set null` rather than `cascade`: deleting a
 * user must never erase the record of what they did.
 */
export const auditLog = createTable(
	"audit_log",
	t => ({
		id: t.serial("id").primaryKey(),
		/** Broad area the event belongs to, e.g. "rbac". Kept generic so auth
		 *  events can adopt this table without a schema change. */
		domain: t.text("domain").notNull(),
		/** What happened, e.g. "role.assign", "role.remove", "role.create". */
		action: t.text("action").notNull(),
		/** Whether the attempt succeeded or was refused. A denial is evidence. */
		outcome: t.text("outcome").notNull().default("success").$type<"success" | "denied">(),
		/** Who acted. Null only for system-initiated events. */
		actorId: t.text("actor_id").references(() => users.id, { onDelete: "set null" }),
		/** Kind of thing acted on, e.g. "user", "role". */
		targetType: t.text("target_type"),
		/** Identifier of the thing acted on, as text so any key type fits. */
		targetId: t.text("target_id"),
		/** State before and after, plus any denial reason. Shape is per-action. */
		oldValue: t.jsonb("old_value").$type<unknown>(),
		newValue: t.jsonb("new_value").$type<unknown>(),
		reason: t.text("reason"),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
	}),
	t => [
		// The read endpoint is strictly reverse-chronological.
		index("audit_log_created_at_idx").on(t.createdAt),
		index("audit_log_actor_id_idx").on(t.actorId),
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
		/** When an unpaid booking stops holding its slot; null once paid. */
		holdExpiresAt: t.timestamp("hold_expires_at"),
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
// PAYMENTS (PAY-1)
// ============================================================================

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
// RELATIONS
// ============================================================================
export const relations = defineRelations(
	{
		users,
		sessions,
		accounts,
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
		payments,
		paymentEvents,
		receipts,
	},
	r => ({
		users: {
			sessions: r.many.sessions(),
			accounts: r.many.accounts(),
			userRoles: r.many.userRoles(),
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
		payments,
		paymentEvents,
		receipts,
	},
	relations
)
