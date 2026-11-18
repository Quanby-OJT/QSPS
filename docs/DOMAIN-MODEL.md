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
policy · announcement · notification · device_token
audit_log · sync_operation · import_batch ──< import_row
```

## 4. Core tables and lifecycle notes

All tables are defined with `createTable` in `packages/db/src/schema.ts`. Money is integer centavos. Timestamps are UTC; business dates are computed in Asia/Manila.

| Table | Key columns | Lifecycle notes |
| -- | -- | -- |
| `users` (template) | * `account_type` (`client`/`staff`), `mobile`, `gender` (free text), `birth_date`, `nationality`, `legacy_id`, `must_reset_password`, `disabled_at`, `location_id?` | Never hard-deleted; disabled instead. `location_id` is the staff Location claim used by processing screens until `user_scopes` (ADM-2) replaces it; null means no processing access. |
| `user_scopes` | `user_id`, `service_category_id?`, `location_id?` | A null column means "all". No rows means no scoped access for scoped roles. |
| `roles`, `permissions`, `user_roles`, `role_permissions` (template) |  | Permissions are seeded from the catalog. |
| `audit_log` (template) | * `actor_role`, `ip_address`, `user_agent`, `prev_hash`, `entry_hash` | Insert-only. Database trigger rejects update and delete. |
| `locations` | `id` (primary key), `code` (unique, uppercase), `name`, `address`, `region`, `is_active` | Disabled locations are excluded from new-booking pickers; existing bookings are unchanged. Physical deletion is refused until booking references can be checked. |
| `service_categories` | `code`, `name` | Seeded with the eight codes in the glossary. |
| `services` | `service_category_id`, `code`, `name`, `fee_centavos`, `requires_approval`, `document_type?`, `is_active` | Fee changes apply to new Bookings only. |
| `schedule_slots` | `id` (primary key), `service_id`, `location_id`, `starts_at`, `ends_at`, `capacity`, `booked_count`, `is_disabled` | Unique on `service_id`, `location_id`, `starts_at`. `booked_count` changes only inside the booking transaction (Flow B). Capacity cannot go below `booked_count`; a slot with bookings is disabled, never deleted. A disabled slot takes no new bookings and keeps existing ones. |
| `form_templates`, `form_fields` | `service_id`, `version`, `is_active`; field `type`, `label`, `required`, `options`, `position` | Editing a published template creates a new version. |
| `form_submissions` | `booking_item_id`, `form_template_id`, `answers` (jsonb) | Immutable after payment; staff corrections go in `assessments`. |
| `bookings` | `id` (primary key), `reference_number` (unique, `QSPS-YYMMDD-XXXXXX`), `client_id`, `status`, `kind` (`regular`/`expedite`/`vip`/`walk-in`), `total_centavos`, `hold_expires_at`, `created_by` | State machine 5.1. Only `BookingService` changes `status`. `hold_expires_at` is set from the hold Policy (60 minutes from env until ADM-6). |
| `booking_items` | `id` (primary key), `booking_id`, `service_id`, `schedule_slot_id`, `location_id`, `fee_centavos`, `status` | State machine 5.2. `fee_centavos` is the Service fee at booking time. |
| `payment_channels` | `code`, `name`, `provider_code`, `convenience_fee_centavos`, `convenience_fee_bps`, `is_enabled` | Switching provider is a row update. |
| `payments` | `booking_id`, `channel_code`, `provider_code`, `provider_reference`, `amount_centavos`, `convenience_fee_centavos`, `status`, `needs_review`, `collected_by?` | State machine 5.3. `amount_centavos` is the full amount charged: the Booking total plus `convenience_fee_centavos`. `(provider_code, provider_reference)` is unique. One `succeeded` Payment per Booking is the rule; it is enforced in `PaymentService.confirm`, not by a unique index, because a second success is real money and must still be recorded, with `needs_review` set. `needs_review` is also set for a late success on a cancelled Booking (D7). |
| `payment_events` | `payment_id?`, `provider_code`, `provider_event_id` (unique per provider), `payload`, `signature_valid`, `processed_at`, `created_at` | Raw log of every provider notification, stored before it is checked. Insert-only; `processed_at` is the one later write. `payment_id` is null when the notification names no known payment. An event whose signature does not verify is stored under `unverified:<sha256 of body>` instead of the provider's event id, so a forged event can never block the real one as a duplicate. |
| `receipts` | `payment_id` (unique), `receipt_number` (unique), `verification_token`, `issued_at` | Created once, in the same transaction that marks the Payment `succeeded`. |
| `refund_requests` | `booking_id`, `kind` (`refund`/`forfeiture`), `status`, `reason`, `requested_by`, `decided_by` | `requested → approved → settled`, or `rejected`. |
| `assessments` | `booking_item_id`, `staff_id`, `outcome` (`cleared`/`returned`/`rejected`), `notes`, `corrections` (jsonb) | Insert-only history. Each row also moves the Booking Item (5.2) in the same transaction, through `BookingService`. |
| `documents` | `booking_item_id?`, `document_type`, `document_number` (unique per type), `verification_token` (unique), `issuing_location_id`, `issued_at`, `status` (`valid`/`revoked`/`superseded`), `source` (`qsps`/`legacy`), `payload` (jsonb) | Never deleted. Reissue creates a new row and supersedes the old one. |
| `policies` | `key` (unique), `value` (jsonb), `updated_by` | Every change is audited with old and new value. |
| `announcements` | `title`, `media_url`, `starts_at`, `ends_at`, `is_active` | The Gender and Development flash screen. |
| `notifications` | `user_id`, `channel` (`email`/`sms`/`push`), `template`, `payload`, `status`, `attempts`, `dedupe_key` (unique) | Outbox: `queued → sent`, or `failed` after retries. |
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
| `pending_payment` → `cancelled` | Hold expires; arrival cutoff passes unpaid; client cancels | Slot capacity is released in the same transaction |
| `paid` → `completed` | Every Booking Item is `issued`, `rejected`, or `no_show` |  |
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

`checked_in` is refused unless the parent Booking is `paid`. `cleared` goes to `pending_head_approval` first when the Service has `requires_approval`. A `returned` item goes back to `in_assessment` when staff open it again after the client corrects it.

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
| `users` | auth (Better Auth) | admin-settings, migration | Profile columns are written by auth and admin-settings services; credentials only by Better Auth. Migration sets `legacy_id` and `must_reset_password`, never a password hash it cannot verify. |
| `notifications` | notifications | booking, payments, certificates | Other epics call `NotificationService.enqueue` with a `dedupe_key`; only the outbox worker changes `status`. |
| `policies` | admin-settings | booking, payments | Other epics read through `PolicyService.get(key)`; none write. |

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