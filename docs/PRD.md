# PRD — QSPS Lean PRD

Quarantine Services and Payment System for the Bureau of Quarantine (BOQ).
Source: BOQ bidding document, Section VII Technical Specifications / Terms of Reference, pp. 69–113 ("TOR"). Section numbers below (§) refer to the TOR.
Prepared 2026-11-13. Companion documents: "DOMAIN-MODEL" and "TICKETS — Build order and risky flows". In the repository this is `docs/PRD.md`.

## Problem

BOQ's current Online Booking and Scheduling System with ePayment must be replaced by a fully integrated system that covers every quarantine service, not only booking and payment (§I). Clients queue and pay in person, staff re-encode data, issued documents cannot be verified online, and the International Health Surveillance Division has no real-time data.

## Goal

One account-based platform (web, Android, iOS) where a client registers, books one or more BOQ services, pays online or onsite, is assessed by BOQ staff, and receives a QR-verifiable document. BOQ keeps full administrative control, a complete audit trail, and ownership of all data and source code (§II, §VI, §X).

## Primary users

| User | What they do | TOR role (Annex A) |
| -- | -- | -- |
| Client | Registers, books, pays, downloads documents | Client / Customer |
| Processing officer | Encodes, verifies, processes, issues certificates, works offline | Processing Officer / Encoder |
| Cashier | Collects onsite payments, issues receipts | Cashier |
| Module head | Runs one service area in assigned locations | Module Admin |
| BOQ ICT / management | Users, settings, policies, nationwide oversight | System Admin, Super Admin |
| Auditor | Read-only transactions, reports, audit logs | Auditor / View-only |
| Public | Scans a QR code to verify a document | none (no account) |

Roles are data, not code. Every check in the system is against a permission key, never a job title.

## Scope

In scope (software): system admin settings, customer portal, BOQ admin portal, online verification, mobile apps, offline mode for selected staff functions, payment integration, reports and dashboards, legacy data migration, and exit turnover (§VIII.1–5, §VIII.8, §IX, §XVII).

Required by the TOR but outside the development tickets (DevOps and QA): production hosting at `qsps.boq.gov.ph`, TLS, firewall and patching, backups and restore tests, uptime monitoring and SLA alerts, load and security testing (§IX, §XI, §XXII). These remain contract obligations and are listed as "Not software" in the compliance matrix.

## Non-goals

* Guest or anonymous booking, payment, or document issuance (§VIII.2).
* Refunds executed automatically by the system. Refunds follow a BOQ–provider memorandum of agreement; the system records and tracks the request only (§VIII.3).
* Building a payment gateway. QSPS integrates gateways through one provider interface.
* Hardware procurement and logistics as development tickets. They are tracked in the checklist at the end of this document.
* Client-side offline booking. Offline mode is for staff encoding and temporary transaction recording only (§VIII.8).
* Self-service kiosk hardware. The TOR calls kiosks optional; one ticket delivers a kiosk-mode payment screen that runs on any locked-down browser.

## Key constraints

* **Stack.** Quanby `turbo-template`: Turborepo + pnpm, Next.js 16 (web), NestJS (API), oRPC contracts with Zod in `packages/contracts`, Drizzle ORM + PostgreSQL in `packages/db`, Better Auth in `packages/auth`, Redis, Flutter (mobile), Docker images deployed to AWS through the template's GitHub Actions.
* **Timeline.** Four months from Notice to Proceed: 4 weeks design, 8 weeks build and test, 4 weeks commissioning (§VII). There are 78 tickets of one to two days each, which is 78 to 156 developer-days against 40 working days, so the 8-week build needs four developers working in parallel.
* **No vendor lock-in.** No proprietary dependency may stop BOQ or a successor from running the system (§X.D). Payment, SMS, email, push, and storage sit behind interfaces.
* **Payment before service.** No service is rendered until payment is completed and validated by the system (Annex B).
* **Account-based.** Every booking, payment, and document belongs to a registered account (§VIII.2).
* **Audit is append-only.** No user, including Super Admin, can edit or delete audit entries (§VIII.1).
* **Old documents stay verifiable.** Documents issued by the previous system must verify in the new portal (§VIII.4).

## Non-functional requirements

| Area | Requirement | Source |
| -- | -- | -- |
| Timezone | All schedules, cutoffs, and reports use Asia/Manila; timestamps stored in UTC | decision |
| Currency | PHP, stored as integer centavos | decision |
| Availability | 99.9% monthly uptime for portals, API, mobile, and payment integration | §IX.A, §XXII.2 |
| Performance | Pages load in 2–5 seconds on average | §IX.A |
| Recovery | RPO 15 minutes, RTO 4 hours, daily automated backups, quarterly restore test | §XXII.10 |
| Backups to BOQ | Scheduled, encrypted, automatic copies to BOQ's servers; BOQ can restore unaided | §IX.B |
| Security | TLS 1.2+, encryption at rest for sensitive data and backups, firewall, malware protection, patching | §IX.C |
| Authentication | MFA mandatory for staff, optional for clients; CAPTCHA; password rotation for staff; staff sign-in not linked from the public site | §II, §VIII.1–2 |
| Privacy | Data Privacy Act (RA 10173); retention period set by BOQ; no deletion without written approval | §IX.C |
| Controls | COA Circular 2021-014: audit trail, user permissions, unique transaction numbers, QR verification | §II |
| Integrations | An online payment gateway (not fixed; any gateway plugs in through the provider interface), Landbank `Link.Biz`, SMS and email with a registered sender name, FCM/APNs push | §V, §VIII.2 |
| Support SLAs | Critical incident: respond in 30 minutes, resolve in 4 hours; vulnerability fixes within 24 hours (critical) | §XXII.3, §XXII.11 |
| Turnover | Source, database backup, API docs, configuration within 5 working days of a written request | §XXII.12 |

## Definition of Ready

A ticket may start when its acceptance criteria are in Given/When/Then form, its dependencies are merged, its permission keys exist in the catalog in the DOMAIN-MODEL document, and any risky flow it names has been read.

## Definition of Done

Code and tests merged · acceptance criteria pass · permission and audit checks verified · PR reviewed · docs updated.

## Decisions made

### Business-fact decisions (answered by the team on 2026-11-13)

| \# | Decision | Rationale |
| -- | -- | -- |
| B1 | Build on `Quanby-IT-Solutions/turbo-template` | Team standard; it already ships auth, RBAC, audit, idempotency, PWA offline groundwork, and CI/CD |
| B2 | Payment is gateway-agnostic: every gateway is an adapter behind one provider interface, with no gateway-specific types outside its adapter. Paynamics, first named as the partner, is no longer planned (updated 2026-11-13); the replacement gateway is not yet selected | The team wants to switch providers easily; §X.D forbids lock-in |
| B3 | No access to the legacy system yet: build the import pipeline against a neutral staging format, and keep the real field mapping as a separate ticket blocked on the data hand-over | Migration is mandatory (§VI) but the source schema is unknown |
| B4 | The Physical Examination and Laboratory flowcharts and the sample reports are not available: every service uses one configurable workflow, and report layouts are confirmed at data gathering | The TOR cites annexes that are not in pp. 69–113 |

### Best-practice decisions (made without asking)

| \# | Decision | Rationale |
| -- | -- | -- |
| D1 | Permission keys are `module.submodule:action` | Keeps the module/submodule/action vocabulary and the template's `resource:action` matching, including its `resource:*` wildcard |
| D2 | TOR roles are seeded as data; the template's `Admin` super-role becomes Super Admin | Annex A roles must stay admin-configurable |
| D3 | Module Admin limits are enforced by data scope (service category + location), not by separate roles per office | One role, many offices; Annex A "assigned scope" |
| D4 | A checkout is one Booking with one Booking Item per service | §VIII.3 multi-service selection: one checkout, separate components and charges |
| D5 | Book Now, Pay Later holds a slot until a policy-defined deadline, then auto-cancels; one unpaid booking per account at a time | Annex B anti-slot-hoarding and "One Email = One Schedule" |
| D6 | Payment status changes only on a verified provider notification or a cashier confirmation, never on the browser redirect | Redirects can be forged or lost |
| D7 | A payment that arrives after auto-cancel is kept, flagged, and routed to staff; it never silently reactivates a slot | Protects both the client's money and slot capacity |
| D8 | Document verification is a server lookup by an unguessable token in the QR code | The printed copy cannot be trusted; the record can |
| D9 | Offline writes carry a client-generated ID and replay through the template's idempotency interceptor | Prevents duplicates on sync (§VIII.8) |
| D10 | Database changes ship as additive Drizzle migrations (`db:generate` + `db:migrate`), never `db:push`, outside local development | Production data must survive every release |
| D11 | Production runs on managed PostgreSQL with point-in-time recovery and two application instances behind the load balancer | Needed for RPO 15 minutes and 99.9% uptime |
| D12 | The template deploys to AWS `ap-southeast-1` (Singapore). Hosting region is listed as an open item for the BOQ Project Management Team | The TOR requires Data Privacy Act compliance but does not state data residency |
| D13 | Refunds and forfeitures are recorded as requests with an approval trail; money movement happens outside the system | §VIII.3 defers the process to an agreement not yet signed |
| D14 | "RCO" is carried as a service category code with no special behaviour until BOQ defines it at data gathering | The TOR never expands the abbreviation |
| D15 | Ticket blocks follow the format parsed by the template's `scripts/tickets-to-issues.mjs` and `scripts/tickets-to-linear.mjs` | The tickets file can be imported to GitHub Issues or Linear unchanged |

### Open items for the BOQ Project Management Team (none block Release 1)

1. Hosting region and any in-country data residency requirement.
2. Retention periods for audit logs and transaction data (§VIII.1, §IX.C).
3. Slot-hold period, arrival cutoff, reschedule limits, and forfeiture rules (Annex B, §VIII.3).
4. Confirm or correct assumptions A1 to A7 below: other policies, major changes, the laboratory and X-ray flow, Food Export and Water Testing, RCO, dashboard components, and module reports.
5. Convenience fee amounts per channel, set in the agreement among BOQ, Landbank, the Bureau of the Treasury, and the provider (§V).
6. Certificate templates and numbering formats for each document type.
7. Selection of the online payment gateway, then its merchant credentials and integration guide; Landbank `Link.Biz` merchant enrolment.

## Non-code deliverables (tracked outside the tickets)

| Deliverable | Due | Source |
| -- | -- | -- |
| Project implementation schedule | 5 calendar days from Notice to Proceed | §VIII.11 |
| 60 passbook printers and 60 desktop computers delivered, installed, tested at the listed sites | 30 calendar days from Notice to Proceed | §IV, §VIII.6–7, §VIII.11 |
| 85 printer ribbons | every quarter | §IV |
| User training nationwide; cloud operations training for BOQ ICT | within 5 calendar days of deployment | §VIII.11, §XIII |
| Test plan and User Acceptance Test plan, approved by the Project Management Team | Phase 1 | §XI |
| System documentation, manuals, database design, flowcharts | Phase 3 | §XII |
| System Backup Plan and Disaster Recovery Plan | Phase 3 | §IX.B, §XIV |
| Agreement among BOQ, Landbank, Bureau of the Treasury, and the provider | after Notice to Proceed | §V |
| Data Protection Officer designation; notarized non-disclosure agreement | contract start | §IX.C, §XX |
| One technical staff member onsite at BOQ Main Office, 8 hours a day; 24/7 help desk | contract duration | §VIII.10, §XXII.1 |
| Mobile app registration in Google Play and the Apple App Store under BOQ's accounts | Phase 3 | §VIII.2 |

## Open items added after the compliance check (2026-11-13)

* Paynamics must confirm that it offers every payment channel the TOR lists: GCash, Maya, Visa/Mastercard, BancNet, GrabPay, 7-Eleven.
* BOQ to confirm or correct assumptions A1 to A7 below.

## Assumptions for items the TOR leaves undefined (team decision, 2026-11-13)

BOQ's answers are not available in time, so these are built on our reading of the TOR. Each is configurable so BOQ can adjust it without new development.

* A1 — "Others" under Policy Management (§VIII.3): other policies are written terms that clients read and accept at booking. Ticket ADM-9.
* A2 — "Approve major changes" by the Super Admin (Annex A): major changes are changes to fees, payment channels and convenience fees, policy values, and roles and permissions. Ticket ADM-10.
* A3 — Clinical Laboratory and X-Ray under Physical Examination (§VIII, §VIII.5): services can pass through ordered stations that each record a result; Physical Examination uses Laboratory, X-ray, and Physician evaluation and ends in a medical certificate. Tickets PRC-4, CRT-9.
* A4 — Food Export and Water Testing (§VIII): exporters apply for a food export certificate per shipment; water sampling ends in an analysis certificate. Ticket CRT-10.
* A5 — "RCO" (§VIII): the collecting officer at a station, who closes each day's collections and records deposits. Ticket PAY-10.
* A6 — Dashboard components "to be defined" (§VIII.3): BOQ chooses components from a library and sets a default per role. Ticket RPT-6.
* A7 — Other functionalities and sample module reports (§VIII.3, §VIII.5): BOQ defines each module report as a saved custom report. Ticket RPT-7.