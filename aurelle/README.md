# Aurelle — salon, beautifully managed

A working salon operations website built from the supplied architecture package. **Aurelle is an illustrative brand**, with synthetic Lahore studios, clients, staff, services, prices, and activity. The architecture files are unchanged.

## Run locally

Requires Node.js 22.12+ (Node 24 was used for verification).

```powershell
cd "C:\Users\LENOVO\Documents\ChatGPT\AWS Hackathon\aurelle"
npm ci
npm run dev
```

- Studio workspace: [http://localhost:3000](http://localhost:3000)
- Customer booking: [http://localhost:3000/book](http://localhost:3000/book)
- Stop cleanly: `npm run stop`

Choose **Explore the studio** on the sign-in screen. The account menu at the bottom of the sidebar switches between sample owner, reception, professional, and customer sessions. This shortcut is available only outside production. For password sign-in, use `owner@aurelle.demo`, `receptionist@aurelle.demo`, or `professional@aurelle.demo` with `Aurelle-demo-2026!`. These are development-only accounts.

The professional sample account is assigned to Meher Ahmed. The customer sample account owns Zara Hassan's visits. Gulberg and DHA demonstrate branch switching; reception and professional access stays scoped to their assigned branch.

Sample appointments are created relative to the **first startup date** in Asia/Karachi. They are not regenerated on every restart. Use the date selector to view the seeded day. Sample staff are available 10:00–20:00 with a 14:00–14:30 break. Service start commands respect duty hours and reserved start time; staff can complete an already-active service after its planned time.

## Working experiences

- Overview with a staff calendar, payment history, service mix, and live studio activity.
- Day calendar and searchable appointment list, sequential multi-service plans, server-priced quotes, five-minute holds, confirmation, cancellation, atomic rescheduling, and rotating QR passes.
- Reception check-in with a recorded verification method or a scanned/pasted pass; separate expected, waiting, active, and checkout boards.
- Call, start, complete, delay, temporary absence, requeue, and atomic station handover. Occupied professionals and stations block another start.
- Customer phone verification, self-booking, personal visit history, pass download, and policy-controlled cancellation. Urdu mode provides RTL layout and key customer labels; translation coverage is partial.
- Client creation, preferences, marketing permission, and history; service publishing with immutable confirmed snapshots; qualified professionals and shifts; concrete stations; stock counts and audited movements.
- Split cash / manager-verified bank payments, immutable invoices and receipts, receipt printing, cash refunds, balanced reversing ledger entries, and cash register reconciliation.
- Aggregate reports and CSV export. Revenue definitions distinguish delivered service value, receipts, outstanding value, and refunds.
- Gemini booking drafts and owner briefs through a real server-side SDK adapter, with explicit unavailable states, role checks, bounded output, service ID validation, and ordinary planner revalidation. No mocked AI response is labelled as Gemini.
- Durable local jobs for reminders and AI, with leases, revision checks, and visible provider acceptance/unknown/disabled status. Booking remains confirmed when messaging is unavailable.

## Storage and security

With no `DATABASE_URL`, development runs real PostgreSQL SQL in PGlite. A complete database snapshot is atomically written to `.data/studio.pglite.tar.gz` after a mutating transaction, before acknowledging it; `.previous` retains the preceding snapshot. A lock prevents two local processes from owning the file. Use `npm run stop` before another process accesses it. This is a **local development adapter**, not the AWS production storage strategy. The original intermediate `.data/postgres` directory from browser QA is preserved separately and is not opened by the app.

With `DATABASE_URL`, the same repositories, range exclusions, constraints, and transactions use the `pg` adapter. Private domain tables have forced tenant row policies. Tenant context is established with `SET LOCAL`; APIs additionally apply branch, actor, and customer checks. Production startup rejects a database owner, superuser, or BYPASSRLS runtime role.

Authentication uses Argon2 password hashes, opaque HMAC-hashed server sessions, HttpOnly/SameSite cookies, CSRF checks, OTP attempt limits, and encrypted TOTP factors. Production cookies require HTTPS. Mutations use durable actor/operation-scoped retry keys and version checks; the client recovers uncertain commands before repeating them. Browser storage contains only branch preference and non-sensitive retry hashes/keys, not session tokens.

## Configuration

Copy `.env.example` to `.env` to change local settings. Environment secrets stay server-side.

| Variable | Purpose |
| --- | --- |
| `PORT`, `APP_ORIGIN` | HTTP port and allowed browser origin |
| `DATA_FILE` | Development snapshot file; default `.data/studio.pglite.tar.gz` |
| `DATABASE_URL` | PostgreSQL connection string, overriding the local adapter |
| `SESSION_SECRET` | 32+ character secret; mandatory in production; changing it revokes sessions and requires an MFA key migration |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Live Gemini adapter; model defaults to the architecture's `gemini-3.8-flash` |
| `SMS_WEBHOOK_URL`, `SMS_WEBHOOK_TOKEN` | Contracted SMS adapter endpoint and credential |
| `DEMO_MODE`, `SEED_DEMO` | Must be false in production |

The SMS adapter receives `{to, message, request_id?}` and an `Idempotency-Key` for scheduled messages. HTTP 2xx is **acceptance**, not proven delivery. A timeout is recorded as unknown and is not automatically resent. Provider status lookup/webhooks must be added for the chosen provider before live rollout. In local demo mode, verification codes are shown explicitly as development codes; no message is claimed to have been sent.

The API includes a separate `npm run worker` entry point. Development runs it within the local process; production runs it as a separate service against PostgreSQL. **Do not run a second worker process against the local snapshot file.**

## Validation

```powershell
npm test
npm run build
```

The integration suite exercises the actual PostgreSQL engine, including `btree_gist` exclusions, deferred ledger constraints, forced row policies under the non-owner runtime role, retries, contention, service handovers, expiry, receipts, refunds, stock, rescheduling, privacy, and snapshot restart. These tests do not substitute for RDS multi-instance, provider, load, recovery, or accessibility acceptance testing.

## Deployment and scope

Docker and development PostgreSQL Compose files are included. Use a separate migration connection for `npm run db:migrate`, and a runtime login inheriting `aurelle_app`. `npm run provision` accepts controlled owner onboarding data through stdin, hashes the password, and encrypts the supplied TOTP factor; it is not a public bootstrap route.

No AWS resources were provisioned, no public deployment was made, and no live SMS, Gemini, or payment credentials were available for validation. The site is delivered locally to retain the specified Express/PostgreSQL backend. See [implementation status](docs/IMPLEMENTATION-STATUS.md) for the exact boundary between the working operational core and the remaining architecture requirements, and [operations](docs/OPERATIONS.md) for deployment and recovery instructions.

## Source map

```text
src/main.tsx             App shell, session state, navigation, route wiring
src/components/          Shared UI and staff calendar
src/pages/               Workforce dashboard and operational pages
src/features/            Booking, customer portal, studio setup
src/api.ts               HTTP boundary, retry recovery, money/time formatting
server/app.ts            Validated HTTP routes, sessions, scopes, SSE
server/domain.ts         Planner, interval merging, command and audit rules
server/operations.ts     Booking, service execution, checkout orchestration
server/db.ts             PostgreSQL/PGlite adapters and scoped transactions
server/schema.sql        Executable schema, exclusions, facts, RLS, ledger constraints
server/ai.ts             Gemini adapter and response validation
server/worker.ts         Durable AI / message / expiration jobs
tests/platform.test.ts   Integration and persistence contracts
```
