# Implementation status

This delivery brings the day-to-day salon concept to life as a working local application. It is not a claim that every production release gate in the supplied four-document architecture has been completed.

## Implemented and runnable

React/TypeScript/Vite UI; Express/TypeScript API; PostgreSQL repositories with a local PGlite adapter; tenant and branch scopes; customer ownership checks; forced domain-table RLS; server sessions and customer OTP; workforce password/TOTP verification; catalogue publishing; concrete staff/resource reservations; ordered services with processing and cleanup; real availability, quotes and holds; confirmation and manual/QR arrival; operation boards; exclusive actual occupancy; call/start/complete/delay/requeue; atomic station handover; cancellation; same-scope atomic rescheduling with pass rotation; stock management; split cash/verified-bank checkout; immutable invoices/receipts; bounded cash refunds and reversing ledger; cash close; aggregate reports; read-only Gemini intent/brief adapter; durable leased local jobs; reminder revision checks; audit events; persisted live invalidations; responsive booking and staff views.

The deterministic planner supports the supplied seeded variants, one recipient/branch per booking, up to six distinct services, 15-minute candidate starts, 90-day search, daily shifts, one or more breaks, weekly days off, sequential phases, qualified categories, and chair/room/nail resources. Colour processing releases the professional while retaining the chair, and its return phase is reserved. Confirmed plans retain service/price snapshots. It does not implement every future optimization or exception rule.

The customer portal includes an Urdu/RTL mode for key navigation and introductory labels. Operational forms and service copy remain primarily English. Do not describe it as a fully translated or audited Urdu interface.

## Provider configuration needed

Gemini uses `@google/genai` on the server. No API key was supplied and no live completion was run. The model/account, region, paid-service data policy, provider terms, multilingual output, prompt-injection resistance, limits, and cost accounting still require the architecture's live-account evaluation. The implementation uses schema-constrained intent extraction over a scoped catalogue, followed by the ordinary planner; it does not implement the full four-call tool broker described in the target design. The AI cannot mutate bookings or money.

SMS has a server adapter and durable scheduled intents. No contracted provider is active; unknown acceptance is held for reconciliation, not blindly retried. Provider-specific callbacks, verified delivery, spend controls, recovery and sandbox/live checks remain. Online gateways, deposit collection, card processing, WhatsApp and accounting exports remain disabled.

## Remaining architecture work before a production release

- AWS IaC and provisioning: ECS multi-replica API/worker/AI services, ALB, RDS Multi-AZ, Redis, SQS/DLQ, S3 quarantine/private media, CloudFront/WAF, Secrets Manager/KMS, tracing and alarms. Included containers are a deployment starting point, not a verified AWS rollout.
- Separate customer/workforce/platform bundles, host-specific session audiences, platform administration, support grants, tenant subscription/onboarding UI, distributed role/membership management, account recovery, OTP ownership recycling safeguards, MFA enrolment/recovery, and step-up workflows beyond controlled provisioning and TOTP sign-in.
- PostgreSQL-backed jobs are implemented. SQS relay/inbox integration, a separate AI-only concurrency pool, durable provider reconciliation, distributed rate limiting and bounded multi-replica fan-out are not. SSE uses scoped invalidations and durable cursors, but not signed audience-bound cursors, 24-hour retention or a dedicated provisioned display-device identity.
- Replacement proposal holds with reusable-interval deltas, price/top-up proposals, partial service termination, approved receivables, no-show automation, unreserved walk-in waiting, future cancellation waitlists, family-organiser linking, and complex staff-assisted quotes/packages.
- Staff shift exceptions/leave/maintenance calendars, preview of the complete future schedule impact list, resource maintenance, cross-branch staff travel and shared-staff allocation, bounded backtracking over complex phase/resource alternatives, essential-product reservations and resource compatibility matrices.
- Versioned tax/discount/promotion/commission policies; tips, retail invoice lines, stock recipe deduction at service completion; receivables, bank refund evidence, commission statements, and complete receipt/cash reporting. Current prices are inclusive amounts with no configured tax or deposit. The UI does not pretend those modules are active.
- Private uploads, media quarantine/scan/consent enforcement, sensitive notes, feedback moderation, customer exports, privacy deletion/tombstones, legal holds and full retention jobs.
- Full Urdu translation and screen-reader/accessibility audit; production generated OpenAPI/client contracts; camera scanner support (manual verification and scanner-paste work); notifications preference UI.
- RDS multi-instance integration, load/failure tests, real provider acceptance, browser automation in CI, security review, backup/restore drills, production release/rollback automation, region/latency validation and staff pilot training.

The initial SQL schema is a practical implemented subset of the logical model. Some immutable service/price details live inside confirmed JSON snapshots rather than the target design's complete normalized version tables. The API documents implemented routes; unimplemented routes return a problem response instead of fabricated success. The reports label sample activity, and no target performance or business-impact claim is presented as measured.
