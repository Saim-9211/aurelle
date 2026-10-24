# MediFlow architecture analysis and reuse decisions

## 1. Evidence and scope

The uploaded `Full Architecture` directory contains `graph.json`, `GRAPH_REPORT.md`, `graph.html`, a file manifest, semantic and AST extraction caches, and historical query memories. It is an architecture/knowledge-graph export, **not the original source tree**. Paths such as `server/src/db/schema.sql` occur in the manifest; the corresponding source files are not included.

The report describes a corpus of 363 files and approximately 222,197 words. The graph has 2,298 nodes and 5,995 edges, and records source commit `8ae2857e78c2b438c14cfda842e3c38f4d6610d3`. It reports 64 inferred edges and 66 unclassified files, including CSS, logs, and database files. These are export metadata, not measurements of the application today. Graph path references and corpus counts need not match one-to-one.

Review covered the report, graph structure, dependency edges, production source symbols, semantic-cache concepts, manifest, and both historical query memories. The extraction caches largely contain nodes and relationships; they do not restore missing function bodies, schema definitions, package versions, endpoint payloads, or deployment configurations.

Evidence labels used below:

- **Observed in export:** a symbol, dependency, or extracted concept exists in the supplied material.
- **Reconstruction:** architectural interpretation supported by multiple exported elements, without original-code verification.
- **New decision:** a requirement or implementation choice for the salon platform.

Local evidence: [graph report](../Full%20Architecture/GRAPH_REPORT.md), [graph JSON](../Full%20Architecture/graph.json), [manifest](../Full%20Architecture/manifest.json), and [historical memories](../Full%20Architecture/memory/).

## 2. Technical structure reconstructed from the export

| Area | Observed evidence | Architectural interpretation and limit |
|---|---|---|
| Frontend | `client/src/App.jsx`, `AuthContext`, `ProtectedRoute`, dashboard layout; dependency edges to React, React Router, Vite, Tailwind, Radix, Lucide, Recharts | React SPA with role-based screens and shared UI. Exact versions and route guards cannot be audited. |
| Client integration | `services/api.js`, role/domain API modules, credential handling, snapshot validators, request stores | Central HTTP boundary, runtime response validation, recovery of uncertain operations. Browser credential persistence requires original-source inspection. |
| Backend | Express dependency; `app.js`, `index.js`, routes, services, repositories, middleware | Layered Node/Express modular application. Business services sit between controllers and repositories. |
| Database | `sql.js` dependency; `queryOne`, `queryAll`, `runInTransaction`, savepoints, snapshot writer and migrations | In-process SQLite-compatible storage with custom persistence. Export explicitly describes a single-worker production model. Exact SQL tables and constraints are unavailable. |
| Authentication | `authenticate`, `authorize`, `assertCurrentSession`, `jsonwebtoken`, `bcryptjs`, `issueOtp`; token-version/session-revocation and six-digit OTP concepts | Password and phone-verification capabilities, role checks, revocation safeguards. Presence of these symbols does not prove correct security behaviour. |
| Business domains | User, clinic, doctor, appointment, schedule, medical-record, notification, audit and analytics repositories | Distinct operational entities and service boundaries. No verified complete ERD can be reproduced from this export alone. |
| Appointment integrity | `bookAppointmentAtomic`, `findAppointmentConflict`, `slotExistsInSchedule`, `scheduleMutation.service.js`, audit helpers | Booking validates availability and coordinates state changes transactionally. Exact conflict rules are unknown. |
| Arrival and queue | `verifyAppointmentArrival`, `admitArrivedAppointmentToQueue`, `hasCurrentArrivalProof`, `orderWaitingEntries`, `projectWaitingTimes` | Arrival evidence is distinct from admission and service execution. Queue policy considers due time, fair waiting, and provider capacity. |
| Walk-ins | `nextAvailableWalkInSlot`, `admitWalkIn`, `recoverWalkIn`, overflow policy | Walk-in admission has its own capacity and durable recovery flow. Clinic-specific overflow rules should not be copied into salon scheduling. |
| Real-time | `/routes/events.js`, `addSseClient`, `canDeliver`, `deferBroadcast`, `broadcastQueueUpdate`, `useScheduleEvents` | SSE with recipient filtering and post-commit publication. Multi-instance fan-out is not established by these symbols. |
| Notifications | Notification outbox schema, reminder scheduler, no-show processing, cursor-based notification feed | Durable notification intent plus scheduled reminders; this pattern is reusable. Provider names and production delivery rates are not established. |
| Records and uploads | Document signature checking, encrypted blob storage, upload budgets, missing-document handling | Sensitive files have storage and capacity controls. Medical record semantics must be replaced. |
| Receipts | Immutable payment receipt snapshots; standard paper and 80 mm printing concepts | Auditable receipts and reception printing are valuable, but the export does not demonstrate an online payment gateway. |
| Time | `CLINIC_TIME_ZONE`, `clinicClock`, calendar helpers, client time synchronisation, overnight queue tests | Server-authoritative timezone handling is a cross-cutting concern. Preserve this discipline. |
| Reliability | Durable request keys, command recovery, savepoint rollback, interruption tests, verified backup manifests | The design pays attention to retries, interrupted writes, persistence, and recovery. Reimplement these guarantees using managed storage. |
| Testing | Queue, appointment concurrency, identity, session, public-display privacy, uploads, accessibility, backup and browser-journey test symbols | Broad engineering test coverage is represented. The tests and their current results are not included for execution. |

## 3. Interfaces and workflows

**Patient interface:** discovery through `DoctorSearch`, booking through `BookAppointmentModal`, appointment management, digital passes, queue status, records and notifications. The client has dedicated cancellation/rescheduling and interrupted-action recovery utilities.

**Doctor interface:** `DoctorDashboard`, doctor queue views, clinical acknowledgments and draft storage. These indicate service delivery alongside patient information and clinical record submission.

**Administrator/reception interface:** appointment worklists, QR scanning, live queue, walk-in admission, doctor availability, clinic settings, reporting, patient details and receipts. Reception is clearly a workflow; it should not automatically be described as a distinct current MediFlow role. A migration symbol named `removeReceptionistRole()` appears in the export, so historical role labels may differ from the current model.

**Public display:** a waiting-room view with dedicated public queue snapshot validation. This suggests deliberate data minimisation for shared displays.

The reconstructed main flow is: authenticate → discover provider and schedule → book transactionally → issue a visit pass → verify arrival → admit to the appropriate queue → call/start service → finish and record outcome → issue receipt and notify. Cancellations, transfers, no-shows and reschedules coordinate appointment and queue state.

## 4. Specific lessons relevant to the new project

1. **Check-in is evidence, not service readiness.** A salon customer may arrive before a room or professional is free, or before an earlier service has finished.
2. **A retry must not become another booking or payment.** Preserve creator-scoped durable request keys, request hashes, recovery reads, and immutable acknowledgments.
3. **Events follow committed state.** Preserve transactional outbox intent. A network notification cannot be the sole evidence of a successful booking.
4. **Public identity differs from private identity.** Retain short visit references for screens and printing, while using opaque internal IDs and scoped authorization.
5. **Time belongs to the business location.** Booking dates, opening hours, reminders and overnight activity need explicit timezone semantics.
6. **Generated passes and scanners share a contract.** One historical query describes an invalid QR-format problem and says direct-source inspection was necessary. The new platform needs a shared, versioned pass schema and round-trip tests.
7. **Engineering evidence is not customer impact.** A historical query mentions 409 regressions and 98 database-verified workflows across 20 routes. These are historical reported engineering results, not independently verified tests, clinic outcomes, or a forecast of salon readiness.

## 5. Retain, adapt, replace

| MediFlow pattern | Salon decision | Reason |
|---|---|---|
| React role interfaces and reusable components | Retain pattern; build new customer, professional, reception, owner and platform screens | Navigation and vocabulary must reflect salon operations. |
| Express routes → services → repositories | Retain, with TypeScript and explicit module ownership | A modular monolith keeps cross-domain transactions manageable. |
| Appointment/pass/arrival lifecycle | Adapt to booking → visit → service steps | One salon visit can involve multiple services and professionals. |
| Doctor schedules | Replace with staff skills, shifts, leave, breaks, resource availability and processing stages | A free professional alone does not establish a feasible appointment. |
| Doctor-centred queue | Replace with branch dispatch over eligible service steps and reserved capacity | Different service durations and resources make one FIFO queue inaccurate. |
| Walk-in admission and recovery | Retain reliability pattern; replace overflow logic | Walk-ins must fit around confirmed reservations and resource occupancy. |
| Patient record | Replace with tenant-scoped customer preferences, service history and consent-controlled notes | Clinical diagnoses and prescriptions do not belong in the salon domain. |
| Custom sql.js snapshots and single worker | Replace with PostgreSQL/RDS transactions and backups | Enable concurrent instances, cross-resource constraints and managed recovery. |
| Durable command/request keys | Retain semantics in database-backed idempotency records | Reliable retries across devices and restarts. |
| Notification outbox and SSE | Retain; add durable stream replay, shared fan-out and durable jobs | Support multiple application instances. |
| Immutable receipt snapshots | Extend to invoices, deposits, split payments, refunds, credits and commissions | Salon checkout is richer than a consultation fee. |
| Encrypted local uploads | Replace storage mechanism with private object storage and managed keys | Scalable, separately recoverable media storage. |
| Clinic settings | Adapt to tenant/branch catalogue, policies, deposits, business hours and tax configuration | Branch rules must be versioned and snapshotted at booking. |
| Clinical draft recovery | Adapt only the recovery technique | Do not copy medical content or patient data. |

This is architectural reuse, not a claim that source components have already been ported. No customer/patient data migration is proposed. Exact legacy API payloads, database DDL, external providers, dependency versions, and current implementation defects remain unverified; the salon contracts are independently specified in the rest of this package.
