# Deployment, implementation and production operations

## 1. Runtime and repository structure

Use one repository with separate deployable entry points and shared domain packages:

```text
apps/
  customer-web/          React customer app and public catalogue
  workforce-web/         React adult workforce app, including AI assistance
  platform-admin/        Restricted platform administration
  api/                   Express HTTP, sessions, authorised SSE
  worker/                Outbox relay, schedules, notifications, reconciliation, exports
  ai-worker/             Gemini jobs, budgets, tool broker, validation
packages/
  contracts/             Request/response/event schemas and generated clients
  domain/                Identity, catalogue, scheduling, visits, commerce, policies
  persistence/           Repositories, migrations, transaction and tenant context
  integrations/          Gemini, SMS, email, gateway and object-storage adapters
  ui/                    Design tokens, accessible shared components, localisation
  observability/         Logging, metrics, tracing and redaction
infra/                   Terraform modules and environment configuration
tests/                   Domain, PostgreSQL, integration, browser, load and failure tests
docs/                    Architecture decisions, OpenAPI and operational runbooks
```

Use a supported Node.js LTS runtime and pin exact runtime/container/package versions in the release lockfile. Select actively maintained React/Express and supporting libraries at implementation; the MediFlow export does not establish reusable version numbers. Prefer typed SQL migrations and repositories with `pg`/a typed query builder; custom SQL implements exclusion constraints and tenant policies. Do not allow an ORM's migration generator to drop these constraints silently.

Use identical domain and schema code for API/worker processes. All entry points run validators and policy checks; jobs do not become a privileged bypass. Prefer REST and SSE over adding GraphQL, Kafka, Kubernetes or microservices before workload measurements justify them.

## 2. AWS deployment topology

Default regional candidate: **Bahrain (`me-south-1`)**, selected for evaluation from Pakistan. Before provisioning production, verify service/model access, provider egress requirements and latency from target Pakistani networks; the region is an explicit design assumption, not a claim of measured latency. The Terraform region parameter supports moving the whole deployment to another supported region. No cross-region active-active booking writes in release one.

| Layer | Production configuration |
|---|---|
| DNS/TLS/edge | Route 53, managed TLS certificates, CloudFront and WAF; distinct customer/workforce/admin hostnames. |
| Frontends | Private static S3 origins accessed via CloudFront origin access control. Hashed assets immutable; HTML short-lived. |
| API routing | `/api/*` and `/api/v1/events` route to ALB with caching disabled and necessary cookies/headers forwarded. SSE buffering disabled and explicitly tested through the full edge path. |
| Containers | ECS/Fargate API service with at least two replicas across two AZs; worker service with at least two replicas using leases; AI worker starts at one and scales within quota. |
| Database | RDS PostgreSQL Multi-AZ instance, private subnets, encrypted storage, TLS required, point-in-time recovery enabled. Supported major/minor pinned; test `btree_gist` and RLS in deployment validation. |
| Cache | Multi-AZ managed Redis-compatible replication group with automatic failover, TLS/auth, no public endpoint. |
| Queues | Separate SQS queues for notifications, integration/reconciliation, exports and AI; each has a DLQ and alarm. |
| Media | Private S3 buckets/prefixes for quarantine, available media and short-lived exports; encryption and lifecycle rules. |
| Secrets | Secrets Manager for database/provider credentials, separate KMS keys where operationally useful; per-task least-privilege roles. |
| Network | ALB entry path protected; API/workers private; DB/cache accept traffic only from required task groups. Controlled NAT egress for external providers; VPC endpoints where cost-effective. |
| Observability | CloudWatch logs/alarms plus OpenTelemetry traces; secrets/PII redacted before export. |
| Build artefacts | Private ECR, vulnerability scanning, immutable release tags and image digest deployment. |

RDS Multi-AZ provides a standby for availability; the standby in this configuration does **not** serve read traffic. Reporting replicas are a separate scaling decision. [RDS Multi-AZ documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html)

RDS supports PostgreSQL backups, point-in-time restores, TLS and private-network deployment; configure and exercise them rather than assuming the product choice itself establishes recovery. [RDS PostgreSQL documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html)

Suggested initial sizing for load tests: two API tasks at 1 vCPU/2 GiB each, two general workers at 0.5 vCPU/1 GiB each, one AI worker at 0.5 vCPU/1 GiB, and a modest managed database sized from observed working set/I/O. These are starting experiments, not guaranteed capacity. Bound each API task to 15 DB connections and each worker to five; ensure the maximum replica counts plus migration/maintenance connections stay below the DB connection budget. Add a connection pool/proxy only after testing transaction/session-context semantics.

CloudFront distributions keep customer/workforce/admin sessions host-specific. The API verifies expected session audience/host along with origin and CSRF; a customer cookie cannot grant access to the workforce API. No shared parent-domain session cookie. Direct ALB access must be restricted so edge controls cannot be bypassed.

Configure the ALB idle timeout above the SSE heartbeat interval, initially 120 seconds with 20-second heartbeats; set upstream application timeout appropriately and test reconnects through CloudFront. ALB defaults to 60 seconds and its idle timer requires data traffic, not HTTP/2 PING. [ALB timeout documentation](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html)

## 3. Environments and configuration

**Local:** containers for PostgreSQL and cache, local object-storage adapter, fake SMS/payment providers, worker processes, and seeded synthetic salons. Gemini tests use fixtures by default; manually enabled live smoke tests use synthetic redacted requests and a separate development key.

**Staging:** separate AWS account or strictly isolated environment, same topology classes and schemas, synthetic customer data, sandbox merchant/SMS credentials, production-like SSE and webhook paths. A smaller database is acceptable, but single-instance staging does not validate multi-instance production behaviour.

**Production:** no seed routes, test bypasses or public initial-admin creation. Separate provider projects/merchant accounts/keys. Protect database deletion, use deployment approvals through the team's release process, and audit emergency access.

Configuration groups include database/TLS, cookie/session audiences, tenant feature defaults, timezone/currency, hold TTL, search bounds, call lease, cancellation policies, webhook secrets, notification templates, Gemini model/budgets, file limits/retention and operational thresholds. Validate configuration at startup. No placeholder secrets or silent fallback to demo providers in production.

Payments, WhatsApp and any export to accounting software remain disabled until their real provider contracts and sandbox validation pass. This is deliberate capability gating: the platform is fully usable with cash, SMS and the core appointment flows; enabling online deposits requires a working verified gateway. Gemini must pass a real synthetic production-account smoke test before the release is considered to meet the mandatory AI requirement.

## 4. Release and migration process

Pipeline: formatting/type checks → schema/OpenAPI validation → domain tests → PostgreSQL integration and tenant-isolation tests → contract/provider fixtures → frontend build → container/dependency/secret scan → ephemeral staging deployment → browser smoke and cross-replica concurrency checks → production canary → expand.

Apply migrations once through a dedicated job with an advisory migration lock. Use expand/backfill/contract migrations: add compatible columns/tables first, deploy code that supports both forms, backfill in bounded batches, verify, then enforce constraints/remove old fields in a later release. Maintain backward-compatible event payloads for queued older jobs. Record migration version with release metadata.

Canary evaluation covers booking conflict rate, API failures, payment mismatches, outbox age and queue lag. Roll back application images when compatible; do not blindly run a down-migration that loses bookings or money. If a schema change is incompatible, disable the affected feature and deploy a forward repair. During task shutdown stop claiming work, finish or release leases, drain HTTP requests and close SSE so clients replay on another instance.

## 5. Targets, scaling and cost controls

These are proposed launch acceptance targets, **not measured performance claims**:

| Measure | Initial target / scope |
|---|---|
| Pilot capacity | 100 branches, up to 20 simultaneously working professionals per branch; validate workload mix before expansion. |
| API load | 100 requests/second sustained in mixed reads/writes; exercise 10 competing holds on the same resource and larger burst tests separately. |
| API latency | p95 under 500 ms for ordinary reads and one second for booking mutations; excludes external checkout and AI. |
| Availability search | p95 under two seconds for a bounded six-item, one-day request; complexity-limited response explicit. |
| SSE scale/freshness | 5,000 concurrent connections; p95 event visibility within two seconds, recovery within ten seconds after reconnect. |
| Booking correctness | Zero committed conflicting reservations, duplicate charges from retry, or cross-tenant reads in acceptance tests. |
| Core availability | 99.9% monthly target for booking/operations API; provider failures measured separately. |
| Reminder scheduling | Due jobs claimed within 60 seconds under target load; delivery delay tracked separately. |
| AI response | p95 target under 15 seconds; 20-second application processing budget; fallback always usable. |
| Recovery | Core database target RPO ≤5 minutes and RTO ≤60 minutes, subject to measured restore/failover drills. |

Autoscale API on CPU, request latency and SSE connection count, not CPU alone. Scale workers on oldest-message age and backlog, with provider rate caps. Scale AI separately so Gemini slowness cannot consume booking connections. Use tenant-level quotas to protect shared capacity from one busy branch or abusive client.

Scale PostgreSQL vertically first; optimise indexed queries and plan search. Use read replicas/materialised aggregates for historical reports, not hold confirmation or money checks. If branch-row serialization becomes a measured bottleneck, move to deterministic asset locks while preserving schedule-edit locking and exclusion constraints. Extract independent modules only when deployment or workload boundaries justify it; scheduling/booking/visit invariants should remain one transaction boundary as long as feasible.

Budget through a worksheet using regional current prices at provisioning: fixed DB/standby, cache, ALB and NAT costs + task CPU/memory hours + storage/backups + requests/egress + SMS and gateway fees + Gemini input/output usage. Do not present speculative monthly totals. Put alarms and hard admission caps on SMS OTP spending, AI tenant budgets and bulk exports. Cache only non-sensitive published catalogue data; repeated personal AI prompts are not a shared cache strategy.

## 6. Monitoring and incident response

Every request carries a correlation ID into commands, jobs, webhooks and audit events. Trace major scheduling steps and transaction durations; log reason codes and IDs, not tokens, full prompts, photos or personal notes.

Monitor: success/error rate and p95/p99 latency; DB lock waits/deadlocks, pool saturation and storage; outbox oldest unpublished event; SQS backlog/leases/DLQ; reminder lag; SSE disconnects and replay gaps; provider webhook verification failures; pending/unallocated payments and refund age; stock inconsistencies; forecast error; AI validation failures, tokens, cost and fallback rate. Security alerts cover cross-scope denials, suspicious OTP volume, export spikes and support grants.

| Failure | Runtime response | Operator recovery |
|---|---|---|
| API replica dies after commit | Client recovers original command result; SSE reconnects/replays | Replace replica, inspect request/command trace. |
| PostgreSQL unavailable/failover | Reject writes; display a clear temporary outage; no fake confirmations | Wait for managed failover, verify integrity and reconcile uncertain commands. |
| Cache unavailable | Read primary, poll durable events; conservative local limits or fail closed for OTP/high-risk requests | Restore cache; it must not require rebuilding booking truth. |
| Worker crashes after provider send | Lease expires; retry uses stable request/provider keys or reconciles unknown status | Inspect inbox/outbox and provider state before replay. |
| SQS unavailable | Outbox retains work and lag alarm fires | Relay resumes publication; deduplication absorbs duplicate sends. |
| SMS/WhatsApp failure | Booking remains committed; delivery status shows failure | Retry boundedly, offer permitted alternate channel or reception follow-up. |
| Gateway timeout/contradictory callback | Payment remains pending/unknown; no unverified paid status | Query provider, compare settlement, allocate/refund once. |
| Gemini quota/error/invalid result | Assistant reports unavailable; normal booking form/report remains | Circuit breaker, quota/cost review, synthetic health test before re-enable. |
| Professional absence/resource failure | Block new capacity, flag impacted bookings, preserve actual work/history | Manager-approved reassignment, reschedule or refund, with notifications. |
| Data leak suspicion | Revoke sessions/keys, pause affected exports, restrict support access | Preserve redacted evidence; investigate scopes, contain and follow incident obligations. |

Operational runbooks must include failed deployment, stuck hold/lease, lost response, payment reconciliation, refund failure, notification replay, tenant restoration, deletion after restore, key rotation and provider outage. DLQ replays require deduplication checks and a documented operator action; they are not automatic infinite retries.

## 7. Backups and disaster recovery

Enable automated RDS backups/PITR with a proposed 35-day retention, encrypted daily snapshots and protected backup access. S3 versioning plus lifecycle/replication policy protects permitted media; quarantine and temporary exports have short retention. Backups include database schema, object metadata, receipt snapshots, application release versions and the ability to access required encryption keys. Do not put plaintext secrets in backup manifests.

Keep a cross-region encrypted backup copy if the business requires regional-disaster recovery; measure its recovery-point lag separately from the single-region target. Managed Multi-AZ availability is not a substitute for accidental-deletion recovery or regional backup.

At least quarterly, restore to an isolated environment and verify tenant boundaries, representative bookings/reservations, ledger balance, pending provider reconciliation, receipt checksums and accessible media. Disable outgoing messages/payments/AI in restored test environments. Apply deletion tombstones before exposing a restored production system. Reconcile transactions with payment providers after a restore so replayed database state cannot create duplicate financial effects. Record measured RPO/RTO and fix failures before claiming the targets are achieved.

For network or site outage at a salon, reception can use a preprinted minimal day list under local privacy controls and record provisional events on paper. Offline changes are not guaranteed reservations. After recovery, staff reconciles them explicitly with timestamps/reasons and conflicts; the app must not blindly replay an offline mutation queue into live bookings.

## 8. Test and acceptance matrix

| Area | Required scenarios and pass conditions |
|---|---|
| Scheduling | Haircut+manicure needs two professionals; colour processing releases staff but retains chair; return step remains reserved; cleanup, leave, closing time, cross-branch travel and overnight work respected. |
| Capacity concurrency | Multiple API instances request same last slot: at most one commits; multi-asset plans are all-or-nothing; failed hold leaves no partial reservations or stock deductions. |
| Expiry | Worker outage leaves old holds until command cleanup; expired hold cannot confirm; no time-dependent constraint bug; extension does not exceed limit. |
| Reschedule | Old slot remains reserved until swap; overlapping replacement succeeds using deltas; price top-up failure keeps original; stale revision fails; expired replacement releases only delta. |
| Arrival/queue | Generated QR round-trips through both scanners; cancelled/old/replayed passes cannot create a new visit; manual lookup is scoped; early/late/absent cases; two call-next commands pick only one winner. |
| Service execution | Start blocked for occupied resources, missing prerequisite/consent or off-duty staff; completion advances correct step; overrun cannot start another customer in same chair; all occupancy closes correctly. |
| Payments | Duplicate callbacks, out-of-order callbacks, wrong signature/currency/merchant/amount, late capture after expiry, refund retries, split payments, partial refunds, lost provider responses and settlement mismatches. |
| Financial correctness | Ledger balances by currency, deposits not counted as delivered revenue, invoice allocation exact, no double commission/stock movement, immutable receipt after catalogue edits. |
| Isolation | Swap tenant/branch/customer IDs in every route, tool, job, object access, export and SSE replay; pooled DB sessions cannot retain tenant context; support grants expire. |
| Session security | OTP limits/atomic consume, session fixation/revocation, MFA recovery, CSRF, cookie audience, account switch recovery and recycled phone ownership. |
| Reliability | Kill API before/after commit and worker before/after publish; restart cache; replay outbox; task drain; DB failover; verify acknowledged commands survive and no money duplicates. |
| Real-time | Connect to two API instances, lose wakeups, reconnect with old cursor, exceed replay retention, revoke session mid-stream, slow client buffer, privacy of display projections. |
| AI | English/Urdu/Roman Urdu intent and date parsing; no fabricated service/quote IDs; budget arithmetic; prompt injection; tools denied after role revocation; no mutation, private-record leak or medical advice; fallback within budget. |
| Uploads/privacy | Fake MIME, oversized image, malware, missing object, expired link, metadata stripping, consent withdrawal, deletion and restored-backup tombstones. |
| Frontend | Keyboard and screen-reader journeys, Urdu RTL, narrow screens, camera denied, poor network, double-click, session expiry during checkout, stale event and clear pending/failed/success states. |
| Production | Restore drill, multi-instance load test, least-privilege roles, provider sandbox/live synthetic smoke, alert delivery, release rollback and incident runbooks. |

Use property-based tests for interval planning: reservations never overlap exclusive assets; start/end ordering is valid; branch-local dates round-trip; plan expansion preserves total phases; cost allocations sum exactly. Use real PostgreSQL for exclusions, RLS and transactions; an in-memory substitute cannot validate these behaviours. Browser tests cover complete user journeys; AI unit tests use recorded synthetic outputs and a small versioned multilingual evaluation set.

## 9. Delivery sequence and definition of done

| Stage | Developer deliverables | Exit gate |
|---|---|---|
| 1. Foundation | Repository, environments, migrations, identity, memberships, tenant policies, shared contracts/UI, audit and command recovery | Automated cross-tenant/session checks pass; synthetic branch operates through authenticated APIs. |
| 2. Catalogue and scheduling | Variants/phases, staff/resources, shifts, quotes, holds, reservations and full booking flow | Multi-resource concurrent booking and replacement-hold tests pass against PostgreSQL. |
| 3. Salon floor operations | QR/manual arrival, walk-ins, ready-step dispatch, start/complete, delays, SSE, public display, recovery UI | Two reception devices and professionals complete mixed appointment/walk-in journeys without duplicate occupancy. |
| 4. Commerce and communications | Invoices, cash, stock, commission, reminders, receipts, refund ledger, provider adapters | Financial invariants and callback/reconciliation tests pass; core usable without online gateway. |
| 5. Mandatory Gemini | Adult workforce booking assistant, owner brief, retrieval tools, output schemas, privacy controls, evaluation and budgets | Real synthetic Gemini call succeeds; multilingual and adversarial evaluations pass; outage fallback demonstrated. |
| 6. Production hardening and pilot | Multi-AZ deployment, provider onboarding, load/failure tests, accessibility fixes, backup restore, runbooks and staff training | All production gates met; limited pilot monitored with rollback/support readiness. |

These stages do not permit skipping tenant isolation, idempotency or audit until the end; those foundations precede feature work. Do not label a demo with mocked AI as satisfying the mandatory production Gemini integration.

Pilot with a small number of salons representing appointment-heavy, walk-in-heavy and multi-service operations. Measure observed booking time, wait uncertainty, queue exceptions, no-show rate and staff correction workload against an agreed baseline; do not transplant MediFlow's engineering results into business-impact claims.

## 10. Explicit boundaries and remaining external inputs

The design independently resolves the main product and technical choices. Production configuration still requires actual business/provider inputs: business identity and brand, live branch services/prices/durations, staff qualifications and hours, cancellation/deposit policy, provider merchant/SMS credentials, operational budget, applicable financial retention/tax configuration and deployment-region validation. These are onboarding data and contractual prerequisites, not undefined scheduling or security behaviour.

Release-one boundaries: one recipient/branch per booking, ordered service phases, tangible resource units, no cross-tenant staff conflict detection, no guaranteed offline booking, no medical records, no AI diagnosis, no autonomous AI write tools, no public consumer Gemini chat, no full payroll or stored-value loyalty wallet, and no automatic group-event optimiser. Linked individual bookings support small family/event groups, but do not promise all-or-nothing group capacity; that requires a future group-hold transaction design.

Preserve the new schema and workflows as the source of truth. If original MediFlow source is later provided, review useful components against these contracts before porting them; do not replace the salon model with renamed clinic entities.
