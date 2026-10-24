# Running, deploying, and recovering Aurelle

## Local operation

Use one `npm run dev` process. It serves both the API and Vite, and runs local leased background jobs. Persistent development data lives in the ignored `.data/` folder. `npm run stop` calls a token-protected, loopback-only development control route, drains workers, closes HTTP/SSE connections and saves/closes the database. The route is not mounted in production.

Use a new `DATA_FILE` to start an independent sample workspace. Do not delete a current workspace to get a fresh seed. Preserve the existing snapshot and its `.previous` file. Never run two processes or separate workers against a local snapshot.

The local adapter creates a complete gzip PostgreSQL data snapshot before acknowledging a mutating transaction. It writes and fsyncs a temporary file, retains the preceding snapshot, then replaces the canonical file. A process lock is released on a clean stop; a stale lock can be reclaimed only after verifying that its recorded process is no longer alive. Failure to load an existing snapshot is an error; the app never silently resets it.

For local restore, stop the process, preserve the current snapshot and `.previous` under new filenames, select a **copy** of the previous known-good snapshot through `DATA_FILE`, and start the app. Validate bookings, payments and stock before proceeding. Local development snapshots are PGlite-specific and are not PostgreSQL/RDS backup files. Production requires managed PostgreSQL and its tested backups.

## PostgreSQL development

The optional Compose service binds PostgreSQL to loopback. Supply a local password through `LOCAL_POSTGRES_PASSWORD` and run `docker compose up -d`. Set `DATABASE_URL` to that database and run `npm run db:migrate`. Do not put real credentials in committed source. This Compose configuration is for development, not a production database.

## Controlled onboarding

Use the migration/operator DB connection for `npm run provision`. The command accepts a JSON object through stdin with `business_name`, `branch_name`, `address`, `owner_name`, `email`, `password` (14+ characters), and an existing `totp_secret` (Base32). Supply secrets through a secure operator session; do not put them on a shell command line or commit them. The operator must establish the factor with the intended owner through their normal trusted provisioning process. The command prints only resulting IDs.

Provision staff profiles, qualifications and concrete stations before enabling services. The app can create professionals/stations/products/services, but creating a professional profile does not grant workforce login access. Additional workforce identities and their factor setup remain controlled onboarding work.

## Production container preparation

1. Use an isolated PostgreSQL database with `btree_gist` available. Run migrations with a dedicated migration account, once per release under the deployment's migration lock.
2. Create a separate runtime login inheriting `aurelle_app`, with no table ownership, superuser or BYPASSRLS. Supply its connection string through Secrets Manager. Do not run production as the migration account.
3. Set `NODE_ENV=production`, `DEMO_MODE=false`, `SEED_DEMO=false`, `APP_ORIGIN` to the exact HTTPS origin and a strong `SESSION_SECRET`. Production startup rejects an embedded database, weak/missing secret, enabled sample shortcuts or an overprivileged DB role.
4. Build with `docker build -t aurelle:release .`. Pin tested base-image and application image digests in the release pipeline. Docker was not installed in the build environment, so this container has not been executed here.
5. Run the API container and a separate worker container using `npm run worker`. Database migrations/provisioning use an operator job with the migration connection; the API and worker use the runtime connection. Do not run development seed jobs in production.
6. Configure ALB health checks at `/api/v1/health/ready`; set a tested idle timeout above the heartbeat, initially 120 seconds. Forward cookies, origin/CSRF/idempotency/version headers and SSE reconnect headers without caching `/api/*`.
7. Add the remaining topology and release safeguards in `IMPLEMENTATION-STATUS.md` before accepting real customer or financial data. In particular, separate origins/bundles, strong support/identity recovery, distributed limits, provider contracts and RDS restore drills are not replaced by this container.

## Operational recovery rules

- **Uncertain command:** recover using its original actor, operation and key at `GET /api/v1/commands/{key}?operation=...`. Do not create a new payment to hide an uncertain result. The browser retains only a request hash/key and reuses it for a matching retry.
- **Expired hold:** the worker or next canonical read deactivates its reservations. The confirmation command rechecks expiry and cannot confirm it.
- **Provider unknown:** leave the message job `unknown`; reconcile the stable request ID with the provider before another send. Accepted is not delivered.
- **Gemini failure:** the job becomes unavailable; use normal booking and deterministic reports. Never fabricate an assistant success or a booking confirmation.
- **Cash discrepancy:** record counted and expected values. Preserve the discrepancy and investigate with receipt/payment/refund/audit references.
- **Database unavailable:** reject writes. Do not invent confirmations or replay an offline booking queue.
- **Production restore:** restore into isolation, disable outgoing providers, check tenant visibility, reservation overlaps, posted ledger balances and provider reconciliation before returning service. Restore/deletion policies and RPO/RTO need measured production drills.

## Verification performed

`npm test` includes PostgreSQL-backed conflict/idempotency, role/privacy/RLS, sequential phases, expiry, service/reset handover, split checkout, immutable facts, refunds, balanced ledger, stock, rescheduling/pass rotation, unconfigured AI fallback and clean local snapshot restart scenarios. `npm run build` typechecks and creates the production frontend bundle. Browser QA exercises the staff and customer interfaces at their available desktop and narrow browser widths. It is not a substitute for a complete accessibility, cross-device, provider or distributed-system acceptance audit.
