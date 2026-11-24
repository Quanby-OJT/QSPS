# DOMAIN-MODEL — Glossary, entities, state machines, permission keys

Shared vocabulary for every QSPS ticket. Use these names in table, contract, module, and screen names. Section references (§) are to the TOR. In the repository this is `docs/DOMAIN-MODEL.md`.

## 1. Glossary

| Term | Meaning |
| -- | -- |
| **Client** | A registered member of the public. Owns Bookings, Payments, and Documents. |
| **Staff user** | A BOQ employee account. Holds one or more Roles and a set of Scopes. |
| **Role** | A named, admin-editable bundle of Permissions. The seven TOR roles (Annex A) are seeded Roles. |
| **Permission** | One key the API checks before an action. Format in section 2. |
| **Scope** | The Service Categories and Locations a Staff user may act on. Empty scope means nationwide and is reserved for Super Admin, System Admin, and Auditor. |
| **Location** | A BOQ office where services are rendered (Manila, Cebu, Davao…). Called station, branch, or satellite office in the TOR. |
| **Service Category** | A BOQ service area: `immunization`, `physical-exam`, `sanitation`, `food-safety`, `human-remains-bio`, `food-export-water`, `cashier`, `rco`. The TOR's "module". |
| **Service** | One bookable, priced item inside a Service Category, such as yellow fever vaccination or the basic hygiene seminar. |
| **Schedule Slot** | Capacity for one Service at one Location on one date and time window. |
| **Form Template** | An admin-built questionnaire attached to a Service. A client's answers are a **Form Submission**. |
| **Booking** | One checkout by one Client. Has a Reference Number and one or more Booking Items. The TOR's "transaction". |
| **Booking Item** | One Service in a Booking, with its own Schedule Slot, fee, and processing status. The TOR's "transaction component". |
| **Reference Number** | System-generated unique Booking identifier, printed as text and QR code. |
| **Hold** | The period a slot stays reserved for an unpaid Booking before auto-cancel. |
| **Expedite Booking** | A client request for a date with no open slots; needs staff approval. |
| **VIP Booking** | A staff-created Booking that bypasses slot capacity. |
| **Payment** | One attempt to pay a Booking through a Payment Channel. |
| **Payment Provider** | A gateway integration behind the `PaymentProvider` interface, identified by a code. `linkbiz` and `onsite` are fixed; online gateways are added as adapters under their own code. No gateway is hard-wired. |
| **Payment Channel** | What the client picks at checkout: GCash, Maya, card, BancNet, GrabPay, 7-Eleven, `Link.Biz`, onsite cashier. Each maps to one Payment Provider. |
| **Convenience Fee** | A per-channel charge added at checkout and itemized on the Receipt. |
| **Receipt** | The e-Receipt issued for a successful Payment. |
| **Refund Request** | A tracked request to return or forfeit a paid amount. Money moves outside the system. |
| **Assessment** | A Staff user's verification of one Booking Item: clear, return for correction, or reject. |
| **Document** | An official output issued for a cleared Booking Item: certificate, permit, vaccination record. Carries a Document Number and a Verification Token. |
| **Verification Token** | Unguessable value in a Document's QR code; the public portal looks the Document up by it. |
| **Policy** | A named, admin-editable rule value: hold minutes, arrival cutoff, reschedule limit, forfeiture rule. |
| **Audit Entry** | An append-only record of one user or system action. |
| **Notification** | An outgoing email, SMS, or push message, queued in the outbox. |
| **Sync Operation** | One staff action captured offline and replayed to the API. |
| **Import Batch** | One run of the legacy import pipeline. |
| **System** | The automated actor: sends Notifications, expires Holds, runs sync. Audit Entries by System have no actor user. |

## 2. Permission-key convention

```
<module>.<submodule>:<action>        e.g.  bookings.expedite:approve
```

* `module.submodule` is the template's "resource"; `action` is the verb. The colon is kept because `RbacService` matches wildcards on the text before it: a role holding `bookings.expedite:*` satisfies any `bookings.expedite:<action>`.
* Every key lives in `PERMISSION_NAMES` in `packages/contracts/src/modules/v1/rbac/rbac.catalog.ts`. Unknown keys fail closed.
* Routes declare keys with `@RequirePermissions(...)`; `RbacGuard` enforces them. A denial returns 403 and writes an Audit Entry with outcome `denied`.
* A permission answers "may this user do this kind of thing". Scope answers "on which records". Both are checked on the server (Flow A in the TICKETS document).
* User stories name the key; acceptance criteria and technical notes enforce the same key.

### Catalog

| Module | Keys |
| -- | -- |
| account | `account.profile:manage` |
| users | `users.accounts:read` · `users.accounts:manage` · `users.roles:manage` · `users.scopes:manage` |
| audit | `audit.logs:read` · `audit.logs:export` |
| settings | `settings.locations:manage` · `settings.services:manage` · `settings.policies:manage` · `settings.announcements:manage` · `settings.payment-channels:manage` · `settings.changes:approve` |
| schedules | `schedules.slots:manage` |
| forms | `forms.templates:manage` |
| bookings | `bookings.own:create` · `bookings.own:read` · `bookings.own:reschedule` · `bookings.own:cancel` · `bookings.expedite:request` · `bookings.expedite:approve` · `bookings.vip:create` · `bookings.walk-in:create` · `bookings.all:read` · `bookings.all:reschedule` · `bookings.all:override` |
| payments | `payments.own:create` · `payments.onsite:collect` · `payments.transactions:read` · `payments.refunds:request` · `payments.refunds:approve` · `payments.reconciliation:read` · `payments.deposits:verify` |
| processing | `processing.queue:read` · `processing.assessments:perform` · `processing.assessments:approve` · `processing.offline:use` |
| certificates | `certificates.own:read` · `certificates.documents:issue` · `certificates.documents:print` · `certificates.documents:revoke` |
| reports | `reports.dashboard:read` · `reports.sales:read` · `reports.operations:read` · `reports.transactions:read` |
| migration | `migration.imports:manage` · `migration.exports:create` |

Reading schedules, services, and locations needs only a signed-in session. Public verification needs no session.

### Seeded roles (editable afterwards)

| Role | Grants |
| -- | -- |
| Super Admin | Everything. This is the template's `ADMIN_ROLE` short-circuit. Cannot be removed by anyone else. |
| System Admin | `users.*`, `settings.*` except `settings.changes:approve`, `schedules.*`, `forms.*`, `audit.logs:read`, `bookings.all:*`, `reports.*`, `payments.transactions:read` |
| Module Admin | `users.accounts:read`, `users.accounts:manage`, `schedules.slots:manage`, `forms.templates:manage`, `settings.locations:manage`, `settings.services:manage`, `payments.deposits:verify`, `bookings.all:*`, `bookings.expedite:approve`, `bookings.vip:create`, `processing.*`, `certificates.documents:*`, `reports.dashboard:read`, `reports.operations:read` — all limited by Scope |
| Processing Officer | `processing.queue:read`, `processing.assessments:perform`, `processing.offline:use`, `bookings.walk-in:create`, `bookings.all:read`, `certificates.documents:issue`, `certificates.documents:print` — limited by Scope |
| Cashier, Collecting Officer (RCO) | `payments.onsite:collect`, `payments.transactions:read`, `payments.refunds:request`, `bookings.all:read`, `reports.dashboard:read` — limited by Scope |
| Auditor | `audit.logs:read`, `audit.logs:export`, `payments.transactions:read`, `payments.reconciliation:read`, `reports.*`, `bookings.all:read` |
| Client | `account.profile:manage`, `bookings.own:*`, `bookings.expedite:request`, `payments.own:create`, `certificates.own:read` |

## 3. Entities and relationships

```
role >──< permission                      (role_permissions)
role >──< user ──< user_scope >── service_category
                        └──────>── location

service_category ──< service ──< schedule_slot >── location
                        └──< form_template ──< form_field

user(client) ──< booking ──< booking_item >── service
                    │             ├──>── schedule_slot
                    │             ├──< form_submission
                    │             ├──< assessment >── user(staff)
                    │             └──< document
                    ├──< payment ──< payment_event
                    │       └──── receipt
                    └──< refund_request

payment_channel >── payment_provider (code)
policy · policy_document ──< policy_acceptance >── booking
announcement · notification · device_token
audit_log · sync_operation · import_batch ──< import_row
user ──< password_history
user ──── mobile_verification_challenges      (one pending code per user)
sms_code_limits                               (per number and per account)
```

## 4. Core tables and lifecycle notes

All tables are defined with `createTable` in `packages/db/src/schema.ts`. Money is integer centavos. Timestamps are UTC; business dates are computed in Asia/Manila.

| Table | Key columns | Lifecycle notes |
| -- | -- | -- |
| `users` (template) | * `account_type` (`client`/`staff`), `mobile`, `gender` (free text), `birth_date`, `nationality`, `legacy_id`, `must_reset_password`, `password_changed_at`, `disabled_at`, `deleted_at`, `two_factor_enabled`, `mobile_verified_at?`, `sms_notifications_enabled` (default false), `mfa_otp_channel` (`email`/`sms`, default `email`) | Never hard-deleted; disabled or soft-deleted instead (`deleted_at` excludes the account from the default list while keeping history and audit entries). `two_factor_enabled` is set by Better Auth once a second factor is enrolled (AUTH-2). `password_changed_at` is set each time a password is set or changed (AUTH-3); null means unchanged since `created_at`. A staff account whose password is older than the `auth.staff_password_max_age_days` Policy gets `must_reset_password` at sign-in and must set a new password before anything else. Failed sign-in counts and account lockouts (AUTH-3) live in Redis, not on this table. NTF-2: `mobile_verified_at` is set when the client confirms a code sent to `mobile`; changing `mobile` clears it and turns `sms_notifications_enabled` off. SMS notifications need a verified number. `mfa_otp_channel` chooses where the AUTH-2 one-time sign-in code goes; `sms` needs a verified number and an enrolled second factor, and changing it needs the password. |
| `two_factors` (Better Auth) | `user_id`, `secret`, `backup_codes`, `verified`, `failed_verification_count`, `locked_until` | One row per user who enrolled a second factor (AUTH-2). Written only by the Better Auth two-factor plugin; the secret and recovery codes are stored encrypted. Five consecutive wrong codes lock the challenge for 15 minutes. MFA is mandatory for `account_type = staff` and optional for clients. |
| `password_history` | `user_id`, `password_hash`, `created_at` | Insert-only from the auth package (AUTH-3). Holds the hash of each password a staff account sets, newest five kept. A new staff password must differ from all of them. Never returned by any API. |
| `user_scopes` | `user_id`, `service_category_id?`, `location_id?` | A null column means "all". No rows means no scoped access for scoped roles. |
| `roles`, `permissions`, `user_roles`, `role_permissions` (template) |  | Permissions are seeded from the catalog. |
| `audit_log` (template) | * `actor_role`, `ip_address`, `user_agent`, `prev_hash`, `entry_hash` | Insert-only. Database trigger rejects update, delete, and truncate for every role. `entry_hash` is sha256 of `prev_hash` plus the row's fields, so `pnpm audit:verify` finds any row changed outside the application. Rows from before FND-3 have no hash. System actions have no actor, role, IP, or user agent; `domain` names the job. |
| `locations` | `id` (primary key), `code` (unique, uppercase), `name`, `address`, `region`, `is_active`, `card_offset_x_mm`, `card_offset_y_mm` (real, default 0) | Disabled locations are excluded from new-booking pickers; existing bookings are unchanged. Physical deletion is refused until booking references can be checked. CRT-3: the card offsets shift the vaccination card print for that station's passbook printer (positive X right, positive Y down, -30 to 30 mm, rounded to 0.1 mm); set on the Locations screen and audited with the other Location fields. |
| `service_categories` | `code`, `name` | Seeded with the eight codes in the glossary. |
| `services` | `service_category_id`, `code`, `name`, `fee_centavos`, `requires_approval`, `document_type?`, `auto_issue` (default true), `is_active` | Fee changes apply to new Bookings only. `document_type` is a key in the document-type registry that a Service can issue (currently `icv-record`) or null; free text is refused. `medical-exemption` is issued in place of `icv-record` and is never set on a Service (CRT-3). When `auto_issue` is on, the Document is issued in the same transaction that makes a Booking Item `cleared`: the officer's clear when no head approval is needed (CRT-1), a head approval, or an override (CRT-1a). `issued_by` is whoever made the item cleared; they enter the certificate details or, for a vaccination Service, record the medical exemption instead (CRT-3). |
| `schedule_slots` | `id` (primary key), `service_id`, `location_id`, `starts_at`, `ends_at`, `capacity`, `booked_count`, `is_disabled`, `disabled_reason?` | Unique on `service_id`, `location_id`, `starts_at`. `booked_count` changes only inside the booking transaction (Flow B). Capacity cannot go below `booked_count`; a slot with bookings is disabled, never deleted. A disabled slot takes no new bookings and keeps existing ones. SCH-2: a bulk capacity change covers one Manila day, Monday-based week or calendar month and leaves any slot whose `booked_count` is above the new capacity unchanged, listing it back. Blocking a date sets `is_disabled` and `disabled_reason` on that date's slots; a slot already disabled by hand keeps `disabled_reason` null, so unblocking the date (which clears only slots with a reason) leaves it disabled. Paid Bookings on a blocked date are listed for follow-up and never cancelled automatically. |
| `form_templates`, `form_fields` | `service_id`, `version`, `status` (draft/published/retired), `is_active`, `published_at`, `created_at`, `updated_at`; field `form_template_id`, `type`, `label`, `required`, `options` (jsonb, choice types only), `position` | Editing a published template creates a new version. One draft and one published version per Service (partial unique indexes); publishing retires the previous published version and keeps it. A version with Form Submissions cannot be deleted, only disabled (`is_active` false) (FRM-1). |
| `form_submissions` | `booking_item_id` (unique), `form_template_id`, `answers` (jsonb), `created_at` | Written by `BookingService` in the transaction that creates the Booking (FRM-2), against the Service's active Form Template version (published and enabled); answers are keyed by form field id and checked with `checkFormAnswers`, the same rules the web uses. The client may replace them while the Booking is `pending_payment`; immutable after payment, staff corrections go in `assessments`. A file answer is uploaded to `form-uploads/pending/<user_id>/<uuid>.<ext>` (`FileStorage`: PDF, JPG or PNG up to 5 MB, content checked) and copied to `form-uploads/<user_id>/<uuid>.<ext>` when the answers are saved; the stored answer always holds that confirmed key (FRM-2b). A daily job (03:00 Asia/Manila) deletes pending files older than 24 hours; confirmed files are kept. One submission per Booking Item. Staff with `processing.queue:read` whose Scope covers the item can download a file answer from Assessment (FRM-2c); each download is audited as `form_upload.read`. |
| `bookings` | `id` (primary key), `reference_number` (unique, `QSPS-YYMMDD-XXXXXX`), `client_id`, `status`, `kind` (`regular`/`expedite`/`vip`/`walk-in`), `total_centavos`, `hold_expires_at`, `pay_onsite` (default false), `cancel_reason?` (`hold_expired`/`no_show`/`client_cancelled`), `cancelled_at?`, `created_by` | State machine 5.1. Only `BookingService` changes `status`. `hold_expires_at` is set from the hold Policy (`booking.hold_minutes`, ADM-6). BKG-2: `pay_onsite` is set when the client chooses to pay at the BOQ cashier; the hold then no longer applies and `hold_expires_at` is cleared. The expiry job (`apps/backend/src/common/maintenance/`, every minute) cancels a `pending_payment` Booking with reason `hold_expired` once `hold_expires_at` passes (online only), or with reason `no_show` once its earliest slot starts within `booking.arrival_cutoff_minutes` (any unpaid Booking). Both wait while the Booking has an `initiated` or `pending` Payment younger than the payment timeout (60 minutes), since money may still arrive. The client can cancel their own unpaid Booking (`bookings.own:cancel`, reason `client_cancelled`). `cancel_reason` and `cancelled_at` are set only together with `status = cancelled`; every cancellation releases one place in each item's slot in the same transaction. A client has at most one `pending_payment` Booking; booking again is refused with that Booking's Reference Number. |
| `booking_items` | `id` (primary key), `booking_id`, `service_id`, `schedule_slot_id`, `location_id`, `fee_centavos`, `reschedule_count`, `status` | State machine 5.2. `fee_centavos` is the Service fee at booking time. |
| `payment_channels` | `code`, `name`, `provider_code?`, `convenience_fee_centavos`, `convenience_fee_bps`, `is_enabled`, `created_at`, `updated_at` | Switching provider is a row update, read on every payment, so it needs no deployment (PAY-5). `provider_code` is null until an administrator assigns one, and a channel cannot be enabled without it. Convenience fee = `convenience_fee_centavos` + `convenience_fee_bps`/10,000 of the Service fees, rounded half up to the centavo (`chargeFor` in the payments module, used by checkout and `PaymentService.create`; the Receipt prints the Payment's stored figures). Changes apply to new Payments only and are audited with old and new values. Seeded with TOR §VIII.2's channels, all disabled. `payments.channel_code` has no foreign key, so Payments made before a channel row existed stay valid. |
| `payments` | `booking_id`, `channel_code`, `provider_code`, `provider_reference`, `amount_centavos`, `convenience_fee_centavos`, `status`, `needs_review`, `collected_by?`, `tender_type?` (`cash`/`card`/`check`) | State machine 5.3. `amount_centavos` is the full amount charged: the Booking total plus `convenience_fee_centavos`. `(provider_code, provider_reference)` is unique. One `succeeded` Payment per Booking is the rule; it is enforced in `PaymentService.confirm`, not by a unique index, because a second success is real money and must still be recorded, with `needs_review` set. `needs_review` is also set for a late success on a cancelled Booking (D7). Onsite payments (PAY-4) have `channel_code` and `provider_code` `onsite`, no convenience fee, and `collected_by` and `tender_type` set; they are created and confirmed in one transaction through `PaymentService.collectOnsite`, and the `onsite` provider accepts no notifications. |
| `payment_events` | `payment_id?`, `provider_code`, `provider_event_id` (unique per provider), `payload`, `signature_valid`, `processed_at`, `created_at` | Raw log of every provider notification, stored before it is checked. Insert-only; `processed_at` is the one later write. `payment_id` is null when the notification names no known payment. An event whose signature does not verify is stored under `unverified:<sha256 of body>` instead of the provider's event id, so a forged event can never block the real one as a duplicate. |
| `receipts` | `payment_id` (unique), `receipt_number` (unique), `verification_token` (unique), `client_name`, `channel_name`, `service_lines` (jsonb `[{serviceName, feeCentavos}]`), `issued_at` | Created once, in the same transaction that marks the Payment `succeeded` (PAY-2), including a late success flagged `needs_review`. `receipt_number` is `QSPS-R-YYMMDD-NNNNNN` (Manila issue date, Payment id); it is the e-Receipt number, not BOQ's Official Receipt series. `verification_token` is 128 random bits, base64url, and is what the receipt QR code links to. `client_name`, `channel_name` (the channel code when it has no row) and `service_lines` are copied when the receipt is created (PAY-2a), so a reprint shows the names as they were at payment time even after a rename; receipts issued before PAY-2a were backfilled with the names current at migration time. The PDF is rendered on demand from this row and its Payment and is never stored. |
| `refund_requests` | `booking_id`, `kind` (`refund`/`forfeiture`), `status`, `reason`, `requested_by`, `decided_by` | `requested → approved → settled`, or `rejected`. |
| `assessments` | `booking_item_id`, `staff_id`, `outcome` (`cleared`/`returned`/`rejected`), `kind` (`assessment`/`approval`/`override`, default `assessment`), `notes`, `corrections` (jsonb) | Insert-only history. Each row also moves the Booking Item (5.2) in the same transaction, through `BookingService`. PRC-3: `kind = approval` is the head's decision on a `pending_head_approval` item (`cleared` approves; `returned` sends it back to `in_assessment`); `kind = override` clears a `rejected` item and `notes` holds the mandatory reason. |
| `documents` | `booking_item_id?`, `document_type`, `document_number` (unique per type), `verification_token` (unique), `issuing_location_id`, `issued_by?`, `issued_at`, `valid_until?`, `status` (`valid`/`revoked`/`superseded`), `source` (`qsps`/`legacy`), `payload` (jsonb), `print_count` (default 0) | Never deleted. Reissue creates a new row and supersedes the old one. At most one `valid` Document per Booking Item (partial unique index). `document_number` is `{PREFIX}-{LOCATION CODE}-{YYYY}-{NNNNNN}`, e.g. `ICV-MNL-2026-000001`: one counter per document type and Location that never resets; `YYYY` is the Manila issue year only. `verification_token` is 128 random bits, base64url, and is what the QR code links to (`/verify/{token}`). `payload` holds everything printed, copied at issue time; its shape is set per document type. For `icv-record`: vaccine batch/lot number (required), vaccinator name (required), valid from (required), valid until (null = does not expire), passport/ID number (optional, never shown on public verification), plus the client and service details. CRT-3: `icv-record` is also the vaccination card; printing it produces the layout for the pre-printed yellow card, shifted by the issuing Location's card offsets. `medical-exemption` (prefix `MEC`) is issued instead of `icv-record` for a vaccination Service when the client is medically exempt; its payload holds the medical reason (required), examining physician (required), valid from (required), valid until (null = does not expire), passport/ID number (optional), plus the client details and the vaccine the client is exempt from. A Service's `document_type` can only be `icv-record`; `medical-exemption` is never set on a Service. Every print by staff (`certificates.documents:print`) increments `print_count` and writes an Audit Entry `document.print` with the new count; a count above 1 is a reprint. Only `valid` documents can be printed. The PDF is rendered on demand and never stored. Created only by `DocumentService.issue`, inside the transaction that marks the item `issued`. Public verification (CRT-2) returns only type, number, masked holder name (first letter of each word), issuing Location, issue date, status, and `updated_at` as the status-change date when not `valid`; lookup is by `verification_token`, or by `document_number` plus the token's last 8 characters (printed under the QR code). |
| `document_sequences` | `document_type`, `location_id`, `next_number` (default 1) | Unique on `document_type`, `location_id`. Read and incremented with a row lock inside the issuing transaction, so a number is never used twice. No year column: numbers do not reset yearly (CRT-1). |
| `policies` | `id` (primary key), `key` (unique), `value` (jsonb), `updated_by?`, `created_at`, `updated_at` | One row per Policy BOQ has changed; a key with no row reads its documented default. Keys, types, ranges and defaults live in the policy registry in `packages/contracts` (`POLICY_DEFINITIONS`), and the policy screen lists every registered key, so a key added by a later ticket appears without a screen change. A value is validated against its key's type and range before it is stored. Every change is audited with key, old value, new value and actor. Changing a value needs `settings.policies:manage`. Other code reads through `PolicyService.get(key)` (cached in Redis, cleared on write; falls back to the database, then to the default). ADM-6 keys: `booking.hold_minutes` (integer 5–1440, default 60), `booking.arrival_cutoff_minutes` (minutes before the slot starts after which an unpaid Booking is cancelled, 0–1440, default 30), `booking.max_reschedules` (0–10, default 1), `booking.reschedule_min_hours_before` (0–720, default 24), `booking.expedite_enabled` (boolean, default true), `booking.vip_daily_limit` (VIP Bookings per Location per day, 0–1000, default 10), `payment.forfeit_on_no_show` (boolean, default false), `payment.refund_window_days` (0–365, default 30), `auth.lockout_threshold` (1–20, default 5), `auth.lockout_minutes` (1–1440, default 15), `auth.staff_password_max_age_days` (1–365, default 90). When set, `BOOKING_HOLD_MINUTES`, `AUTH_LOCKOUT_THRESHOLD`, `AUTH_LOCKOUT_MINUTES` and `AUTH_STAFF_PASSWORD_MAX_AGE_DAYS` replace the default of their key. The behaviour each policy drives arrives with BKG-2, BKG-5, BKG-6, BKG-7 and PAY-7. Help desk keys (ADM-8, type text, blank hides the channel): `support.phone` (phone, max 30), `support.email` (email, max 254), `support.ticket_url` (https URL, max 500), `support.hours` (text, max 200), each default `""`; read publicly through `GET /v1/support/contacts`. |
| `policy_documents` | `id` (primary key), `document_key` (one random key shared by every version of a policy), `version` (1, 2, 3…; unique with `document_key`), `title`, `body` (plain text), `applies_to_all_services`, `service_ids` (integer array; empty when it applies to all), `effective_from` (Manila date), `requires_acceptance`, `withdrawn_at?`, `created_by`, `created_at` | ADM-9 (assumption A1). One row per version; a row is never changed after it is written, except `withdrawn_at`. Editing a policy writes a new row with the next `version`, so earlier acceptances keep the version they accepted. For a booking, the version that applies is the newest one of each `document_key` whose `effective_from` is on or before the Manila date, that is not withdrawn, and that applies to all Services or lists the Service. Withdrawing sets `withdrawn_at` on every version of the key. Written only by `PolicyDocumentService`; every write needs `settings.policies:manage` and is audited. |
| `policy_acceptances` | `id` (primary key), `booking_id`, `policy_document_id` (the exact version accepted), `client_id`, `accepted_at` | ADM-9. Unique on `booking_id`, `policy_document_id`. Insert-only, written by `BookingService.create` in the booking transaction. A booking is refused while any applicable version with `requires_acceptance` is not accepted, or when the client accepted a version that has since been replaced. |
| `announcements` | `title`, `media_url`, `starts_at`, `ends_at`, `is_active` | The Gender and Development flash screen. |
| `notifications` | `id` (primary key), `user_id`, `channel` (`email`/`sms`/`push`), `template`, `payload`, `status`, `attempts`, `dedupe_key` (unique), `next_attempt_at` | Outbox (NTF-1): `queued → sent`, or `failed` after five attempts. Rows are inserted only by `NotificationService.enqueue`, inside the caller's transaction, so a change that rolls back queues nothing. The recipient is the Booking's client (record ownership; no permission key). `dedupe_key` is channel, recipient, template and event id, so the same event enqueued twice queues one message. The outbox worker (`apps/backend/src/common/notifications/`, every minute) locks one due row at a time with `FOR UPDATE SKIP LOCKED` and sends it from `MAIL_FROM` (BOQ's registered sender name); a failed send moves `next_attempt_at` (timestamp with time zone) 1, 2, 4, then 8 minutes later. Delivery is at least once: a worker that stops after the mail server accepted a message but before its row is marked `sent` sends it again. `payment_received` carries the e-Receipt PDF and the booking QR. A payment that succeeds on a Booking that can no longer be paid (D7) sends `payment_received_review` instead: the e-Receipt, no booking QR. NTF-2: an `sms` row is queued beside the email for `booking_confirmed`, `payment_received` and `booking_cancelled` when the client has a verified number and SMS turned on. Its payload holds only the Reference Number and a destination digest; the worker rechecks the number and opt-in before sending, and marks a changed or disabled destination `failed`. An SMS is sent from `SMS_SENDER_NAME`, BOQ's registered sender name. One-time codes never go through the outbox. |
| `mobile_verification_challenges` | `user_id` (primary key), `mobile`, `code_digest`, `expires_at`, `failed_attempts` | NTF-2. One pending mobile verification per user. Only a keyed digest of the code is stored. A code expires after 5 minutes; a correct code consumes the row. |
| `sms_code_limits` | `key` (primary key; keyed digest of a number or an account), `window_started_at`, `count` | NTF-2. At most three code sends per number and per account in a 15-minute window, across mobile verification and SMS sign-in codes. Kept in the database so the limit holds across instances. |
| `device_tokens` | `user_id`, `platform`, `token` | Removed on sign-out or provider rejection. |
| `idempotency_keys` (template) |  | Reused for offline replay and payment creation. |
| `sync_operations` | `client_op_id` (unique), `staff_id`, `kind`, `payload`, `status`, `conflict_reason` | `received → applied`, or `conflict → resolved`. |
| `import_batches`, `import_rows` | batch `entity`, `mode` (`dry-run`/`commit`), counts; row `legacy_id`, `raw`, `status`, `error` | Re-running a batch never duplicates: target rows are matched on `legacy_id`. |

## 5. State machines

### 5.1 Booking (the centre of the system)

```
                    ┌── rejected
pending_approval ───┤                         (expedite only)
                    └──► pending_payment ──► paid ──► completed
                              │               │
                              ▼               ├──► forfeited
                          cancelled           └──► refund_requested ──► refunded
```

| Transition | Trigger | Guard |
| -- | -- | -- |
| → `pending_payment` | Client books (or expedite approved) | Slot capacity available; client has no other unpaid Booking |
| `pending_payment` → `paid` | Verified provider notification, or cashier confirmation | Amount matches total + convenience fee |
| `pending_payment` → `cancelled` | Hold expires (`hold_expired`); arrival cutoff passes unpaid (`no_show`); client cancels (`client_cancelled`) | Slot capacity is released in the same transaction. The expiry job waits while a Payment is `initiated` or `pending` and younger than the payment timeout. System cancellations are audited with no actor. |
| `paid` → `completed` | Every Booking Item is `issued`, `rejected`, or `no_show` |  |
| `completed` → `paid` | An approver overrides a rejected Booking Item to `cleared` (PRC-3) | Only through `BookingService.overrideItem`, audited as `booking.reopened` with the reason. The Booking completes again once every item is final. Items of a cancelled, refund-requested, refunded or forfeited Booking cannot be overridden. |
| `paid` → `forfeited` | Forfeiture Policy applies after a no-show | Refund Request of kind `forfeiture` approved |
| `paid` → `refund_requested` → `refunded` | Refund Request approved, then marked settled | `payments.refunds:approve` |

The three client-facing statuses required by Annex B map as: Pending = `pending_approval` or `pending_payment`; Paid = `paid` or `completed`; Cancelled = `cancelled`, `rejected`, `forfeited`, or `refunded`.

Every transition writes the Booking row, then an Audit Entry in the same transaction, then queues Notifications.

### 5.2 Booking Item

```
booked ──► checked_in ──► in_assessment ──► cleared ──► issued
   │                           │   ▲
   ▼                           ▼   │
no_show                     returned         rejected (from in_assessment)
```

`checked_in` is refused unless the parent Booking is `paid`. `cleared` goes to `pending_head_approval` first when the Service has `requires_approval`. PRC-3: a holder of `processing.assessments:approve` inside Scope, who did not perform the clearing Assessment, moves `pending_head_approval` to `cleared` (approve) or back to `in_assessment` (send back, notes required). A `rejected` item stays final for the state machine, but an approver may override it to `cleared` with a mandatory reason; the override is audited with the before and after state. A `returned` item goes back to `in_assessment` when staff open it again after the client corrects it. When the Service issues a Document with `auto_issue` on, every move to `cleared` (an officer's clear with no head approval, a head approval, or an override) continues to `issued` in the same transaction (CRT-1a), and the Booking moves to `completed` once every item is `issued`, `rejected`, or `no_show`.
- **Rescheduling (`BKG-5`):** A client with `bookings.own:reschedule` may move a `booked` item on a `pending_payment` or `paid` booking to another active, non-full `schedule_slot` for the same `service_id` and `location_id` when `reschedule_count < booking.max_reschedules` and the current slot starts at least `booking.reschedule_min_hours_before` hours in the future. Both `schedule_slots` rows are locked in ascending `id` order (`Flow B`), their `booked_count` values are adjusted, `reschedule_count` increments by `1`, and existing `payments` are unchanged.
### 5.3 Payment

```
initiated ──► pending ──► succeeded ──► refunded
                 ├──► failed
                 └──► expired
```

`succeeded` is terminal for money in. A late `succeeded` on a `cancelled` Booking sets `needs_review` on the Payment and leaves the Booking cancelled (Flow C).

## 6. Cross-epic ownership risks

| Table | Written by | Extended by | Ownership rule |
| -- | -- | -- | -- |
| `bookings`, `booking_items` | booking | payments, processing, offline, migration | Only `BookingService` changes `status`. Other epics call its transition methods; none update the column directly. |
| `schedule_slots.booked_count` | schedules (creates rows) | booking | Only `BookingService` changes `booked_count`, always with a row lock. Schedule screens edit `capacity` only and may not set it below `booked_count`. |
| `payments` | payments | reports, migration, offline | Only `PaymentService` writes. Reports read. Offline and migration go through `PaymentService` methods. |
| `documents` | certificates | migration | Migration inserts only rows with `source = legacy` through `DocumentService.importLegacy`; it never updates `qsps` rows. |
| `audit_log` | foundation | every epic | Only `AuditService.record` inserts. No other code touches the table. |
| `users` | auth (Better Auth) | admin-settings, notifications, migration | Profile columns are written by auth and admin-settings services; credentials only by Better Auth. Migration sets `legacy_id` and `must_reset_password`, never a password hash it cannot verify. NTF-2: `mobile_verified_at`, `sms_notifications_enabled` and `mfa_otp_channel` are written only by `MeSmsService`; a profile change that changes `mobile` clears the first two. |
| `notifications` | notifications | booking, payments, certificates | Other epics call `NotificationService.enqueue` with a `dedupe_key`; only the outbox worker changes `status`. |
| `mobile_verification_challenges`, `sms_code_limits` | notifications | auth | Only `MeSmsService` writes `mobile_verification_challenges`. `sms_code_limits` is written only through `reserveSmsCode` in `@repo/auth/sms`, by mobile verification and by SMS sign-in codes. |
| `policies` | admin-settings | booking, payments | Other epics read through `PolicyService.get(key)`; none write. |
| `policy_documents`, `policy_acceptances` | admin-settings | booking | Only `PolicyDocumentService` writes `policy_documents`. Only `BookingService.create` inserts `policy_acceptances`, in the booking transaction. |

## 7. Additions for TOR items built on assumptions (2026-11-13)

These support tickets ADM-9, ADM-10, PRC-4, CRT-9, CRT-10, PAY-10, RPT-6, and RPT-7. The assumptions are listed in the PRD.

New permission keys:

* `settings.changes:approve` — approve major configuration changes. Seeded to Super Admin only; System Admin holds every other settings key.
* `payments.deposits:verify` — verify a collecting officer's deposits. Seeded to Module Admin.

Role changes: Module Admin also holds `settings.services:manage`, limited by Scope. A seeded Collecting Officer (RCO) role holds the same grants as Cashier.

New terms and tables:

* **Policy Document** (`policy_documents`, `policy_acceptances`): a written policy shown at booking; a client's acceptance is stored with its version. Owner: admin-settings.
* **Change Request** (`change_requests`): a major configuration change held until a holder of `settings.changes:approve` approves it. Only `ChangeApprovalService` applies it. Owner: admin-settings.
* **Service Step** (`service_steps`, `step_results`): an ordered station a Booking Item passes through, such as Laboratory, X-ray, Evaluation, with a recorded, versioned result. Only the processing module writes results. Owner: processing.
* **Collection Report** (`collection_reports`, `deposits`): a collecting officer's closed day of onsite Payments and the deposits recorded against it; `open → closed → verified`. Owner: payments.
* **Dashboard Layout** (`dashboard_layouts`): the components a user, or a role by default, sees on the dashboard. Owner: reports.
* **Report Definition** (`report_definitions`): a saved custom report: category, columns, filters, grouping, and the role it is shared with. Owner: reports.

New document types: `pe-medical-certificate`, `food-export-certificate`, `water-analysis-certificate`.