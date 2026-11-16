# TICKETS — Build order and risky flows

Companion to the 78 QSPS development issues in this project. The full text of every ticket lives in its issue; this document holds what the issues refer to but do not contain: the epic map, the story map, the build order, and the six risky flows (Flow A to Flow F) that tickets cite in their technical notes. The complete source file is `docs/TICKETS.md` in the repository.

* 78 tickets in 15 epics. Software development only: production hosting, backups, uptime monitoring, and load and security testing are DevOps and QA work outside this set (their four issues are cancelled). Each is one thin slice through database, API, and UI, sized for one to two days, one branch, and one small pull request.
* Stack: Quanby `turbo-template` — Next.js 16, NestJS, oRPC contracts with Zod, Drizzle and PostgreSQL, Better Auth, Redis, Flutter.
* Actors are permission keys, not job titles. The key in a user story is the key the acceptance criteria and technical notes enforce. Keys are defined in the DOMAIN-MODEL document, section 2.
* Standard create-and-view screens have no flow; their acceptance criteria are enough.

## 1. Epic map

| Epic key | Label | TOR / PRD source | Note | Tickets |
| -- | -- | -- | -- | -- |
| FND | `foundation` | PRD constraints; §VIII.1 audit and roles | Repo, permission catalog, tamper-resistant audit | 3 |
| AUTH | `auth` | §VIII.1–2 authentication and security; §II COA controls | Client accounts, MFA, sign-in hardening, flash screen | 4 |
| ADM | `admin-settings` | §VIII.1 System Admin Settings; §VIII.3 location and policy management; Annex A | Staff users, scopes, roles, audit viewer, locations, services, policies, help contacts, change approval | 10 |
| SCH | `schedules` | §VIII.3 Schedule Management | Slots and capacity per service and location | 2 |
| FRM | `forms` | §VIII.3 Online Form / Questionnaire Management | Questionnaire builder and client answers | 2 |
| BKG | `booking` | §VIII.2 appointment system; §VIII.3 expedite, VIP, multi-service; Annex B | The Booking state machine; owns slot counts | 8 |
| PAY | `payments` | §VIII.1–2 payment and e-Receipt; §V; Annex B | Gateway-agnostic provider interface, first gateway adapter, `Link.Biz`, onsite, receipts, reconciliation, refunds, daily collections | 10 |
| PRC | `processing` | §VIII.3 BOQ Staff Assessment; Annex A | Check-in, assessment, walk-ins, head approval, multi-step results | 4 |
| CRT | `certificates` | §VIII.3 per-service documents; §VIII.4 Online Verification | Document issuance, printing, public QR verification | 10 |
| NTF | `notifications` | §VIII.2 email and SMS with sender name | Transactional outbox; email and SMS | 2 |
| OFF | `offline` | §VIII.8 Offline Functionality | Offline encoding, sync, temporary payment recording | 3 |
| MOB | `mobile` | §VIII.2 Mobile Application; §XXII.8 | Flutter client app for Android and iOS | 6 |
| RPT | `reports` | §VIII.1 transaction view; §VIII.3 dashboard and reports | Dashboard, sales, operations, staff activity, transaction monitor, custom dashboard and reports | 7 |
| MIG | `migration` | §VI, §VIII.4, §X, §XVII, §XX | Legacy import, legacy document verification, turnover export | 6 |
| OPS | `operations` | §IX hosting, backups, security; §XI; §XXII SLA | Data retention and archiving (hosting, backups, monitoring and acceptance testing are DevOps and QA, outside this set) | 1 |

## Story map

Backbone left to right in the order work happens. Release 1 is the thinnest product that works end to end.

| Backbone → | Set up and secure | Configure services and schedules | Register and sign in | Book | Pay | Process and assess | Issue and verify | Notify | Report and audit | Operate and hand over |
| -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- |
| **Release 1 — walking skeleton** | FND-1, FND-2 | ADM-4, ADM-5, SCH-1 | AUTH-1 | BKG-1 | PAY-1, PAY-2 | PRC-1 | CRT-1, CRT-2 | — | — | — |
| **Release 2 — core operations** | FND-3, ADM-1, ADM-2, ADM-7, ADM-8 | ADM-6, ADM-9, SCH-2, FRM-1 | AUTH-2, AUTH-3 | FRM-2, BKG-2, BKG-3, BKG-4, BKG-5 | PAY-3, PAY-4, PAY-5, PAY-6 | PRC-2, PRC-3, PRC-4 | CRT-3, CRT-4, CRT-5, CRT-6, CRT-7, CRT-8, CRT-9, CRT-10 | NTF-1, NTF-2 | ADM-3, RPT-1, RPT-4 | — |
| **Release 3 — go-live readiness** | — | — | AUTH-4, ADM-10, MOB-1 | BKG-6, BKG-7, BKG-8, MOB-2 | PAY-7, PAY-8, PAY-9, PAY-10, MOB-3 | OFF-1, OFF-2, OFF-3 | MOB-4, MIG-4 | MOB-5 | RPT-2, RPT-3, RPT-5, RPT-6, RPT-7 | OPS-4, MIG-1, MIG-2, MIG-3, MIG-5, MIG-6, MOB-6 |

## 2. Build order

Work top to bottom. A ticket may start once its dependencies are merged (they are set as "blocked by" relations on each issue), so tickets in the same release with no dependency between them run in parallel. Release 1 is the walking skeleton: after its twelve tickets a client can register, book, pay, be assessed, receive a document, and have it verified.

### Release 1 — Walking skeleton

 1. [QUANBY-5](https://linear.app/quanby/issue/QUANBY-5/fnd-1-bootstrap-the-qsps-repository-from-turbo-template) — \[FND-1\] Bootstrap the QSPS repository from turbo-template
 2. [QUANBY-6](https://linear.app/quanby/issue/QUANBY-6/fnd-2-seed-the-qsps-permission-catalog-and-the-seven-tor-roles) — \[FND-2\] Seed the QSPS permission catalog and the seven TOR roles
 3. [QUANBY-8](https://linear.app/quanby/issue/QUANBY-8/auth-1-register-a-client-account-by-email-and-complete-a-profile) — \[AUTH-1\] Register a client account by email and complete a profile
 4. [QUANBY-9](https://linear.app/quanby/issue/QUANBY-9/adm-4-manage-boq-locations) — \[ADM-4\] Manage BOQ locations
 5. [QUANBY-10](https://linear.app/quanby/issue/QUANBY-10/adm-5-manage-the-service-catalog-and-fees) — \[ADM-5\] Manage the service catalog and fees
 6. [QUANBY-16](https://linear.app/quanby/issue/QUANBY-16/sch-1-define-schedule-slots-for-a-service-at-a-location) — \[SCH-1\] Define schedule slots for a service at a location
 7. [QUANBY-23](https://linear.app/quanby/issue/QUANBY-23/bkg-1-book-one-service-in-an-available-slot-book-now-pay-later) — \[BKG-1\] Book one service in an available slot (Book Now, Pay Later)
 8. [QUANBY-27](https://linear.app/quanby/issue/QUANBY-27/pay-1-pay-a-booking-online-through-a-gateway-agnostic-payment-provider) — \[PAY-1\] Pay a booking online through a gateway-agnostic payment-provider interface
 9. [QUANBY-32](https://linear.app/quanby/issue/QUANBY-32/pay-2-issue-a-verifiable-e-receipt-for-every-successful-payment) — \[PAY-2\] Issue a verifiable e-Receipt for every successful payment
10. [QUANBY-33](https://linear.app/quanby/issue/QUANBY-33/prc-1-check-in-a-paid-client-and-assess-their-booking-item) — \[PRC-1\] Check in a paid client and assess their booking item
11. [QUANBY-38](https://linear.app/quanby/issue/QUANBY-38/crt-1-issue-a-qr-coded-document-when-a-booking-item-is-cleared) — \[CRT-1\] Issue a QR-coded document when a booking item is cleared
12. [QUANBY-47](https://linear.app/quanby/issue/QUANBY-47/crt-2-verify-a-document-on-the-public-portal-by-qr-code) — \[CRT-2\] Verify a document on the public portal by QR code

### Release 2 — Core operations

13. [QUA-11](https://linear.app/quanby/issue/QUA-11/fnd-3-make-the-audit-trail-tamper-resistant-and-capture-role-ip-and) — \[FND-3\] Make the audit trail tamper-resistant and capture role, IP, and device
14. [QUA-12](https://linear.app/quanby/issue/QUA-12/adm-1-manage-staff-user-accounts-and-their-roles) — \[ADM-1\] Manage staff user accounts and their roles
15. [QUA-17](https://linear.app/quanby/issue/QUA-17/adm-2-limit-staff-to-assigned-service-categories-and-locations) — \[ADM-2\] Limit staff to assigned service categories and locations
16. [QUA-18](https://linear.app/quanby/issue/QUA-18/adm-7-create-and-edit-custom-roles) — \[ADM-7\] Create and edit custom roles
17. [QUA-19](https://linear.app/quanby/issue/QUA-19/adm-3-search-filter-and-export-the-audit-log) — \[ADM-3\] Search, filter, and export the audit log
18. [QUA-20](https://linear.app/quanby/issue/QUA-20/auth-2-add-multi-factor-authentication-mandatory-for-staff) — \[AUTH-2\] Add multi-factor authentication, mandatory for staff
19. [QUA-24](https://linear.app/quanby/issue/QUA-24/auth-3-harden-sign-in-captcha-lockout-staff-password-rotation-unlinked) — \[AUTH-3\] Harden sign-in: CAPTCHA, lockout, staff password rotation, unlinked staff entry
20. [QUA-13](https://linear.app/quanby/issue/QUA-13/adm-6-manage-booking-and-payment-policies) — \[ADM-6\] Manage booking and payment policies
21. [QUA-78](https://linear.app/quanby/issue/QUA-78/adm-8-show-help-desk-contact-channels-in-the-portals) — ADM-8: Show help desk contact channels in the portals
22. [QUA-79](https://linear.app/quanby/issue/QUA-79/adm-9-publish-custom-policies-that-clients-accept-at-booking) — ADM-9: Publish custom policies that clients accept at booking
23. [QUA-34](https://linear.app/quanby/issue/QUA-34/bkg-2-auto-cancel-unpaid-bookings-and-stop-slot-hoarding) — \[BKG-2\] Auto-cancel unpaid bookings and stop slot hoarding
24. [QUA-48](https://linear.app/quanby/issue/QUA-48/ntf-1-send-booking-payment-and-document-emails-through-a-notification) — \[NTF-1\] Send booking, payment, and document emails through a notification outbox
25. [QUA-59](https://linear.app/quanby/issue/QUA-59/ntf-2-send-sms-notifications-and-one-time-codes-with-boqs-sender-name) — \[NTF-2\] Send SMS notifications and one-time codes with BOQ's sender name
26. [QUA-25](https://linear.app/quanby/issue/QUA-25/sch-2-edit-slot-capacity-in-bulk-and-block-dates) — \[SCH-2\] Edit slot capacity in bulk and block dates
27. [QUA-21](https://linear.app/quanby/issue/QUA-21/frm-1-build-a-questionnaire-for-a-service) — \[FRM-1\] Build a questionnaire for a service
28. [QUA-28](https://linear.app/quanby/issue/QUA-28/frm-2-answer-the-service-questionnaire-while-booking) — \[FRM-2\] Answer the service questionnaire while booking
29. [QUA-39](https://linear.app/quanby/issue/QUA-39/bkg-3-book-several-services-in-one-checkout) — \[BKG-3\] Book several services in one checkout
30. [QUA-40](https://linear.app/quanby/issue/QUA-40/bkg-4-view-my-transaction-history-and-booking-details) — \[BKG-4\] View my transaction history and booking details
31. [QUA-29](https://linear.app/quanby/issue/QUA-29/bkg-5-reschedule-my-booking-without-a-refund) — \[BKG-5\] Reschedule my booking without a refund
32. [QUA-35](https://linear.app/quanby/issue/QUA-35/pay-5-configure-payment-channels-provider-routing-and-convenience-fees) — \[PAY-5\] Configure payment channels, provider routing, and convenience fees
33. [QUA-41](https://linear.app/quanby/issue/QUA-41/pay-3-accept-payments-through-landbank-linkbiz) — \[PAY-3\] Accept payments through Landbank `Link.Biz`
34. [QUA-42](https://linear.app/quanby/issue/QUA-42/pay-4-collect-an-onsite-payment-at-the-cashier) — \[PAY-4\] Collect an onsite payment at the cashier
35. [QUA-43](https://linear.app/quanby/issue/QUA-43/pay-6-reconcile-stuck-and-late-payments-automatically) — \[PAY-6\] Reconcile stuck and late payments automatically
36. [QUA-49](https://linear.app/quanby/issue/QUA-49/prc-2-encode-a-walk-in-client-and-create-their-booking) — \[PRC-2\] Encode a walk-in client and create their booking
37. [QUA-44](https://linear.app/quanby/issue/QUA-44/prc-3-require-head-approval-for-selected-services-and-allow-overrides) — \[PRC-3\] Require head approval for selected services and allow overrides
38. [QUA-81](https://linear.app/quanby/issue/QUA-81/prc-4-process-a-service-through-configurable-steps-with-recorded) — PRC-4: Process a service through configurable steps with recorded results
39. [QUA-50](https://linear.app/quanby/issue/QUA-50/crt-3-print-the-vaccination-certificate-card-and-the-medical-exemption) — \[CRT-3\] Print the vaccination certificate card and the Medical Exemption Certificate
40. [QUA-51](https://linear.app/quanby/issue/QUA-51/crt-4-generate-the-physical-examination-application-form-and-request) — \[CRT-4\] Generate the Physical Examination application form and Request for Payment
41. [QUA-60](https://linear.app/quanby/issue/QUA-60/crt-5-issue-sanitary-permits-and-ship-sanitation-certificates) — \[CRT-5\] Issue Sanitary Permits and Ship Sanitation Certificates
42. [QUA-61](https://linear.app/quanby/issue/QUA-61/crt-6-issue-food-safety-training-and-haccp-certificates) — \[CRT-6\] Issue Food Safety Training and HACCP certificates
43. [QUA-62](https://linear.app/quanby/issue/QUA-62/crt-7-issue-human-remains-and-biological-substance-certificates-and) — \[CRT-7\] Issue Human Remains and Biological Substance certificates and permits
44. [QUA-63](https://linear.app/quanby/issue/QUA-63/crt-8-revoke-or-reissue-a-document) — \[CRT-8\] Revoke or reissue a document
45. [QUA-84](https://linear.app/quanby/issue/QUA-84/crt-9-run-physical-examination-through-laboratory-and-x-ray-and-issue) — CRT-9: Run Physical Examination through laboratory and X-ray and issue the medical certificate
46. [QUA-85](https://linear.app/quanby/issue/QUA-85/crt-10-set-up-food-export-and-water-testing-services-and-issue-their) — CRT-10: Set up Food Export and Water Testing services and issue their certificates
47. [QUA-52](https://linear.app/quanby/issue/QUA-52/rpt-1-show-the-applicants-per-branch-dashboard) — \[RPT-1\] Show the applicants-per-branch dashboard
48. [QUA-53](https://linear.app/quanby/issue/QUA-53/rpt-4-monitor-all-transactions-with-search-filters-and-export) — \[RPT-4\] Monitor all transactions with search, filters, and export

### Release 3 — Go-live readiness

44. [QUANBY-26](https://linear.app/quanby/issue/QUANBY-26/mig-1-build-the-legacy-import-pipeline-with-dry-run-and-reconciliation) — \[MIG-1\] Build the legacy import pipeline with dry-run and reconciliation
45. [QUANBY-30](https://linear.app/quanby/issue/QUANBY-30/mig-6-export-a-complete-turnover-bundle-on-request) — \[MIG-6\] Export a complete turnover bundle on request
46. [QUANBY-31](https://linear.app/quanby/issue/QUANBY-31/mig-2-import-legacy-user-accounts-and-let-owners-claim-them) — \[MIG-2\] Import legacy user accounts and let owners claim them
47. [QUANBY-36](https://linear.app/quanby/issue/QUANBY-36/auth-4-show-the-gender-and-development-flash-screen-before-sign-in) — \[AUTH-4\] Show the Gender and Development flash screen before sign-in
48. [QUANBY-80](https://linear.app/quanby/issue/QUANBY-80/adm-10-require-super-admin-approval-for-major-configuration-changes) — ADM-10: Require Super Admin approval for major configuration changes
49. [QUANBY-45](https://linear.app/quanby/issue/QUANBY-45/bkg-6-request-and-approve-an-expedite-booking) — \[BKG-6\] Request and approve an expedite booking
50. [QUANBY-54](https://linear.app/quanby/issue/QUANBY-54/bkg-7-schedule-a-vip-booking) — \[BKG-7\] Schedule a VIP booking
51. [QUANBY-37](https://linear.app/quanby/issue/QUANBY-37/bkg-8-reschedule-or-override-a-booking-as-staff) — \[BKG-8\] Reschedule or override a booking as staff
52. [QUANBY-55](https://linear.app/quanby/issue/QUANBY-55/pay-7-track-refund-and-forfeiture-requests) — \[PAY-7\] Track refund and forfeiture requests
53. [QUANBY-56](https://linear.app/quanby/issue/QUANBY-56/pay-8-match-provider-settlement-files-against-recorded-payments) — \[PAY-8\] Match provider settlement files against recorded payments
54. [QUANBY-57](https://linear.app/quanby/issue/QUANBY-57/pay-9-offer-a-kiosk-mode-for-self-service-onsite-payment) — \[PAY-9\] Offer a kiosk mode for self-service onsite payment
55. [QUANBY-82](https://linear.app/quanby/issue/QUANBY-82/pay-10-close-the-days-collections-and-record-deposits-as-collecting) — PAY-10: Close the day's collections and record deposits as collecting officer
56. [QUANBY-64](https://linear.app/quanby/issue/QUANBY-64/rpt-2-generate-the-sales-and-collections-report) — \[RPT-2\] Generate the sales and collections report
57. [QUANBY-65](https://linear.app/quanby/issue/QUANBY-65/rpt-3-generate-operations-reports-schedules-vaccinations-and-documents) — \[RPT-3\] Generate operations reports: schedules, vaccinations, and documents issued
58. [QUANBY-77](https://linear.app/quanby/issue/QUANBY-77/rpt-5-report-staff-activity-for-module-heads) — RPT-5: Report staff activity for module heads
59. [QUANBY-83](https://linear.app/quanby/issue/QUANBY-83/rpt-6-let-boq-choose-and-arrange-dashboard-components) — RPT-6: Let BOQ choose and arrange dashboard components
60. [QUANBY-86](https://linear.app/quanby/issue/QUANBY-86/rpt-7-build-save-and-export-custom-module-reports) — RPT-7: Build, save, and export custom module reports
61. [QUANBY-66](https://linear.app/quanby/issue/QUANBY-66/off-1-keep-encoding-client-information-when-the-office-is-offline) — \[OFF-1\] Keep encoding client information when the office is offline
62. [QUANBY-72](https://linear.app/quanby/issue/QUANBY-72/off-2-synchronize-offline-entries-without-duplicates-or-conflicts) — \[OFF-2\] Synchronize offline entries without duplicates or conflicts
63. [QUANBY-75](https://linear.app/quanby/issue/QUANBY-75/off-3-record-onsite-payments-temporarily-while-offline) — \[OFF-3\] Record onsite payments temporarily while offline
64. [QUANBY-46](https://linear.app/quanby/issue/QUANBY-46/mob-1-sign-in-register-and-pass-mfa-in-the-mobile-app) — \[MOB-1\] Sign in, register, and pass MFA in the mobile app
65. [QUANBY-58](https://linear.app/quanby/issue/QUANBY-58/mob-2-book-and-reschedule-appointments-in-the-mobile-app) — \[MOB-2\] Book and reschedule appointments in the mobile app
66. [QUANBY-67](https://linear.app/quanby/issue/QUANBY-67/mob-3-pay-a-booking-in-the-mobile-app) — \[MOB-3\] Pay a booking in the mobile app
67. [QUANBY-68](https://linear.app/quanby/issue/QUANBY-68/mob-4-view-history-documents-and-verify-qr-codes-in-the-mobile-app) — \[MOB-4\] View history, documents, and verify QR codes in the mobile app
68. [QUANBY-69](https://linear.app/quanby/issue/QUANBY-69/mob-5-deliver-push-notifications-to-the-mobile-app) — \[MOB-5\] Deliver push notifications to the mobile app
69. [QUANBY-73](https://linear.app/quanby/issue/QUANBY-73/mob-6-publish-the-app-to-google-play-and-the-app-store-under-boqs) — \[MOB-6\] Publish the app to Google Play and the App Store under BOQ's accounts
70. [QUANBY-70](https://linear.app/quanby/issue/QUANBY-70/mig-3-import-legacy-bookings-and-payments-as-read-only-history) — \[MIG-3\] Import legacy bookings and payments as read-only history
71. [QUANBY-74](https://linear.app/quanby/issue/QUANBY-74/mig-4-import-legacy-issued-documents-so-they-verify-in-the-new-portal) — \[MIG-4\] Import legacy issued documents so they verify in the new portal
72. [QUANBY-76](https://linear.app/quanby/issue/QUANBY-76/mig-5-map-the-real-legacy-database-to-the-staging-format-and-rehearse) — \[MIG-5\] Map the real legacy database to the staging format and rehearse cutover
73. [QUANBY-22](https://linear.app/quanby/issue/QUANBY-22/ops-4-apply-data-retention-and-archiving-rules) — \[OPS-4\] Apply data retention and archiving rules

## 3. Risky-path flows

Only paths that are easy to get wrong are drawn. Tickets cite them by name in their technical notes.

### Flow A — Permission and scope enforcement

```
1. Request arrives with a session        → SessionAuthGuard resolves the user (401 if none)
2. RbacGuard reads @RequirePermissions   → RbacService resolves roles → permissions (Redis cache, 60 s)
3. Key held (exact, module.submodule:*, or Super Admin)?
      no  → 403 + Audit Entry (outcome denied, key, actor, IP)
4. Handler loads data through ScopeService.filter / assert
      record outside the user's Service Categories or Locations → 404 + denied Audit Entry
5. Mutation and its Audit Entry commit in one transaction
```

Failure branch: Redis unavailable → permission reads fall through to the database (fail closed, slower, still correct).
Why risky: a permission without a scope check lets a Cebu officer act on Davao records; a scope check done only in the UI is no check.
Tickets: FND-2, ADM-2.

### Flow B — Slot hold and auto-cancel

```
1. Client confirms booking               → open transaction
2. SELECT schedule_slots … FOR UPDATE    (several slots: lock in ascending ID order)
3. booked_count < capacity?  no → refuse "slot full"
      yes → insert booking (pending_payment, hold_expires_at) + items, booked_count + 1, audit, commit
4. Expiry job (every minute)             → SELECT expired pending_payment … FOR UPDATE SKIP LOCKED
5. A payment for it is still pending?    yes → skip this round
6. BookingService.cancel(reason)         → status cancelled, booked_count − 1 per item, audit, notify
```

Failure branch: two clients take the last place at once → the row lock serializes them; the second sees the slot full. Two job instances pick the same booking → SKIP LOCKED gives it to one.
Why risky: overbooking and double release are both silent data corruption, and both show up only under load.
Tickets: BKG-1, BKG-2, BKG-5.

### Flow C — Payment confirmation

```
1. Client chooses a channel              → PaymentService creates payment (initiated), amount = fees + convenience fee
2. PaymentProvider.createCheckout        → client redirected to hosted checkout; payment → pending
3. Provider notifies the public endpoint → store raw payment_event first
4. Verify signature, look up payment by provider reference, compare amount
      invalid → keep the event, change nothing, alert
5. PaymentService.confirm (one transaction, row lock on payment and booking):
      payment already succeeded → return (idempotent)
      payment → succeeded · booking → paid · receipt created · audit · notifications enqueued
   Cashier branch: steps 1 and 5 only, with provider onsite and collected_by set.
```

Failure branch: no notification arrives → the reconciliation job calls queryStatus and runs step 5. Success arrives for a booking already cancelled → payment succeeded + needs_review, booking stays cancelled, staff resolve it. The browser return page never changes state.
Why risky: this is where money and service entitlement meet; duplicates, forgeries, and lost callbacks all occur in production.
Tickets: PAY-1, PAY-3, PAY-4, PAY-6, MOB-3.

### Flow D — Document issuance and verification

```
1. Booking Item is cleared (and head-approved where required)
2. DocumentService.issue (one transaction): lock item · refuse if a document already exists
3. Allocate the next number for (type, location) · generate a 128-bit verification token
4. Insert document (valid) · item → issued · booking → completed when all items are final · audit · notify
5. QR code encodes https://qsps.boq.gov.ph/verify/{token}
6. Public page looks the token up and shows number, type, issuing Location, date, status, masked holder
```

Failure branch: unknown token → "no record found", nothing else disclosed, rate limited. Revoked or superseded → shown as such. Legacy QR content → resolved to an imported document (MIG-4).
Why risky: document numbers must never repeat, a token must never be guessable, and the public page must not leak personal data.
Tickets: CRT-1, CRT-2, MIG-4.

### Flow E — Offline sync

```
1. Staff device loads reference data while online (services, today's slots and queue, form templates)
2. Offline: each action is saved on the device as an operation with a client-generated ID, in order
3. Back online: operations replay in order through the sync endpoint, each with its ID as idempotency key
4. Server re-checks permission and Scope, then calls the same service method the online screen uses
5. Applied → sync_operation applied, audit (actor = the staff user, flagged offline)
6. Cannot apply → sync_operation conflict with reason; dependants are held; independent operations continue
```

Failure branch: replayed twice → the stored result is returned. Slot now full, item already assessed, client already exists, booking cancelled → conflict shown in the sync monitor for retry or discard.
Why risky: duplicates and lost work are the two classic offline failures, and the TOR names both.
Tickets: OFF-1, OFF-2, OFF-3.

### Flow F — Legacy import

```
1. Upload a staging file for one entity   → import_batch (dry-run) + one import_row per record
2. Validate each row (shape, references, duplicates) → report: valid, invalid with reasons, duplicates
3. Commit mode: process valid rows in chunks through the owning service's importLegacy method,
   matching on legacy_id so a re-run updates nothing and inserts nothing twice
4. Reconciliation report: source count, imported, skipped, checksum totals
```

Failure branch: batch dies midway → resume from the last committed chunk. Row references an unknown user, service, or location → invalid, never guessed.
Why risky: the source schema is unknown, the data is personal, and the import must be repeatable at cutover without duplicating anything.
Tickets: MIG-1, MIG-2, MIG-3, MIG-4, MIG-5.

## Tickets that rest on assumptions A1 to A7

Each rests on an assumption listed in the PRD (A1 to A7) and is configurable so BOQ can adjust it.

Release 2:

* [QUA-79](https://linear.app/quanby/issue/QUA-79/adm-9-publish-custom-policies-that-clients-accept-at-booking) — ADM-9: Publish custom policies that clients accept at booking
* [QUA-81](https://linear.app/quanby/issue/QUA-81/prc-4-process-a-service-through-configurable-steps-with-recorded) — PRC-4: Process a service through configurable steps with recorded results
* [QUA-84](https://linear.app/quanby/issue/QUA-84/crt-9-run-physical-examination-through-laboratory-and-x-ray-and-issue) — CRT-9: Run Physical Examination through laboratory and X-ray and issue the medical certificate
* [QUA-85](https://linear.app/quanby/issue/QUA-85/crt-10-set-up-food-export-and-water-testing-services-and-issue-their) — CRT-10: Set up Food Export and Water Testing services and issue their certificates

Release 3:

* [QUA-80](https://linear.app/quanby/issue/QUA-80/adm-10-require-super-admin-approval-for-major-configuration-changes) — ADM-10: Require Super Admin approval for major configuration changes
* [QUA-82](https://linear.app/quanby/issue/QUA-82/pay-10-close-the-days-collections-and-record-deposits-as-collecting) — PAY-10: Close the day's collections and record deposits as collecting officer
* [QUA-83](https://linear.app/quanby/issue/QUA-83/rpt-6-let-boq-choose-and-arrange-dashboard-components) — RPT-6: Let BOQ choose and arrange dashboard components
* [QUA-86](https://linear.app/quanby/issue/QUA-86/rpt-7-build-save-and-export-custom-module-reports) — RPT-7: Build, save, and export custom module reports
