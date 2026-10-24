import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import {
  initDB,
  closeDB,
  db,
  one,
  transaction,
  TENANT,
  BRANCH,
  SECOND_BRANCH,
} from '../server/db.ts';
import { seed, DEMO_OWNER, DEMO_CUSTOMER, DEMO_PRO } from '../server/seed.ts';
import { createApp } from '../server/app.ts';
import { stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { id, localDate, at, addMinutes, findPlans, type Scope } from '../server/domain.ts';
let server: Server, base: string, owner: Client, customer: Client, professional: Client, state: any;
class Client {
  cookie = '';
  csrf = '';
  branch = '';
  async request(path: string, method = 'GET', body?: any, version?: number, key?: string) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}),
        ...(this.branch ? { 'X-Branch-ID': this.branch } : {}),
        ...(method !== 'GET' ? { 'Idempotency-Key': key || id() } : {}),
        ...(version !== undefined ? { 'If-Match': String(version) } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const payload = await res.json();
    if (payload.data?.csrf) this.csrf = payload.data.csrf;
    return { status: res.status, data: payload.data, error: payload };
  }
  async login(role: string) {
    const res = await this.request('/auth/demo', 'POST', { role });
    assert.equal(res.status, 200);
    return this;
  }
}
before(async () => {
  process.env.DEMO_MODE = 'true';
  await initDB(true);
  await seed();
  server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
  owner = await new Client().login('owner');
  customer = await new Client().login('customer');
  professional = await new Client().login('professional');
  state = (await owner.request('/state')).data;
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await closeDB();
});
test('sessions, CSRF, roles, and private profile ownership are enforced', async () => {
  assert.equal((await new Client().request('/state')).status, 401);
  assert.equal((await customer.request('/state')).status, 403);
  const anonymous = new Client();
  anonymous.cookie = owner.cookie;
  assert.equal(
    (await anonymous.request('/customers', 'POST', { name: 'Bad request', phone: '03001234567' }))
      .status,
    403,
  );
  const mine = await customer.request('/bookings');
  assert.equal(mine.status, 200);
  assert.ok(
    mine.data.every(
      (b: any) => b.customer_id === state.customers.find((c: any) => c.name === 'Zara Hassan').id,
    ),
  );
  const other = state.bookings.find((b: any) => b.customer_name !== 'Zara Hassan');
  assert.equal((await customer.request(`/bookings/${other.id}/pass`)).status, 404);
  const proState = await professional.request('/state');
  assert.equal(proState.status, 200);
  assert.ok(proState.data.history.length === 0);
  assert.ok(proState.data.bookings.every((b: any) => !b.customer_phone));
  assert.ok(proState.data.steps.every((st: any) => st.data.professional_name === 'Meher Ahmed'));
  professional.branch = SECOND_BRANCH;
  assert.equal((await professional.request('/state')).status, 403);
  professional.branch = '';
});
test('multi-service planner uses sequential qualified staff and resource phases', async () => {
  const scope: Scope = { tenant: TENANT, branch: BRANCH, actor: DEMO_OWNER, role: 'owner' };
  const date = localDate(new Date(Date.now() + 2 * 86400000));
  const haircut = state.services.find((s: any) => s.name === 'Signature haircut'),
    manicure = state.services.find((s: any) => s.name === 'Classic manicure');
  const plans = await transaction((tx) =>
    findPlans(tx, scope, { service_ids: [haircut.id, manicure.id], date }),
  );
  assert.ok(plans.length > 0);
  const plan = plans[0];
  assert.equal(plan.total_minor, '400000');
  assert.equal(plan.steps.length, 4);
  assert.notEqual(plan.steps[0].professional_id, plan.steps[2].professional_id);
  for (let i = 1; i < plan.steps.length; i++)
    assert.equal(plan.steps[i].starts_at, plan.steps[i - 1].ends_at);
  const impossible = await transaction((tx) =>
    findPlans(tx, scope, { service_ids: [haircut.id, manicure.id], date, budget_minor: '399999' }),
  );
  assert.deepEqual(impossible, []);
  const colour = state.services.find((s: any) => s.name === 'Colour & gloss');
  const cp = await transaction((tx) => findPlans(tx, scope, { service_ids: [colour.id], date }));
  assert.equal(cp[0].steps[1].staff, false);
  assert.equal(cp[0].steps[0].professional_id, cp[0].steps[2].professional_id);
});
test('concurrent holds have one winner, retries deduplicate, and money comes from server quotes', async () => {
  const date = localDate(new Date(Date.now() + 3 * 86400000));
  const service = state.services.find((s: any) => s.name === 'Signature haircut');
  const search = await owner.request('/availability/search', 'POST', {
    branch_id: BRANCH,
    service_ids: [service.id],
    date,
  });
  assert.equal(search.status, 200);
  const quote = search.data[0];
  const payload = {
    quote_id: quote.quote_id,
    plan_fingerprint: quote.plan_fingerprint,
    customer_id: state.customers[0].id,
    accepted_policy: true,
    total_minor: '1',
  };
  const key = id();
  const competing = { ...payload, customer_id: state.customers[1].id };
  const result = await Promise.all([
    owner.request('/booking-holds', 'POST', payload, undefined, key),
    owner.request('/booking-holds', 'POST', competing),
  ]);
  assert.deepEqual(result.map((r) => r.status).sort(), [201, 409]);
  const winning = result.find((r) => r.status === 201)!;
  assert.equal(String(winning.data.total_minor), '250000');
  const retry = await owner.request('/booking-holds', 'POST', payload, undefined, key);
  assert.equal(retry.status, 201);
  assert.equal(retry.data.id, winning.data.id);
  assert.equal(
    (await owner.request('/booking-holds', 'POST', competing, undefined, key)).error.code,
    'IDEMPOTENCY_KEY_REUSED',
  );
  const confirmed = await owner.request(`/booking-holds/${winning.data.id}/confirm`, 'POST', {});
  assert.equal(confirmed.data.status, 'CONFIRMED');
  const reservations = await one(
    db,
    'SELECT count(*)::int AS n FROM reservations WHERE tenant_id=$1 AND booking_id=$2 AND active',
    [TENANT, winning.data.id],
  );
  assert.equal(reservations!.n, 3);
  const before = (await one(db, 'SELECT count(*)::int AS n FROM bookings WHERE tenant_id=$1', [
    TENANT,
  ]))!.n;
  const failed = await one(
    db,
    "SELECT count(*)::int AS n FROM bookings WHERE tenant_id=$1 AND status='HELD' AND starts_at=$2",
    [TENANT, quote.starts_at],
  );
  assert.equal(failed!.n, 0);
  assert.ok(before > 0);
});
test('expiry releases every provisional reservation and cannot confirm', async () => {
  const date = localDate(new Date(Date.now() + 4 * 86400000));
  const service = state.services.find((s: any) => s.name === 'Brow shaping');
  const q = (
    await owner.request('/availability/search', 'POST', {
      branch_id: BRANCH,
      service_ids: [service.id],
      date,
    })
  ).data[0];
  const held = await owner.request('/booking-holds', 'POST', {
    quote_id: q.quote_id,
    plan_fingerprint: q.plan_fingerprint,
    customer_id: state.customers[2].id,
    accepted_policy: true,
  });
  await db.query(
    "UPDATE bookings SET hold_expires_at=now()-interval '1 minute' WHERE tenant_id=$1 AND id=$2",
    [TENANT, held.data.id],
  );
  assert.equal(
    (await owner.request(`/booking-holds/${held.data.id}/confirm`, 'POST', {})).error.code,
    'HOLD_EXPIRED',
  );
  // Cleanup commits through the next canonical read even when the rejected command rolled back.
  await owner.request('/state');
  assert.equal(
    (await one(
      db,
      'SELECT count(*)::int AS n FROM reservations WHERE tenant_id=$1 AND booking_id=$2 AND active',
      [TENANT, held.data.id],
    ))!.n,
    0,
  );
});
test('service completion, partial cash checkout, immutable receipts, refunds and balanced ledger', async () => {
  let latest = (await owner.request('/state')).data;
  const b = latest.bookings.find((b: any) => b.customer_name === 'Eman Tariq');
  const active = latest.steps.find((st: any) => st.booking_id === b.id && st.state === 'ACTIVE');
  assert.equal((await owner.request(`/steps/${active.id}/complete`, 'POST', {}, 999)).status, 412);
  let completed = await owner.request(`/steps/${active.id}/complete`, 'POST', {}, active.version);
  assert.equal(completed.data.state, 'COMPLETED');
  latest = (await owner.request('/state')).data;
  let reset = latest.steps.find((st: any) => st.booking_id === b.id && st.state === 'READY');
  assert.ok(reset);
  assert.equal(
    (await owner.request(`/bookings/${b.id}/checkout`, 'POST', { tender: 'cash' })).error.code,
    'SERVICES_INCOMPLETE',
  );
  reset = (
    await owner.request(
      `/steps/${reset.id}/start`,
      'POST',
      { preparation_confirmed: true },
      reset.version,
    )
  ).data;
  assert.equal(reset.state, 'ACTIVE');
  await owner.request(`/steps/${reset.id}/complete`, 'POST', {}, reset.version);
  const key = id();
  const first = await owner.request(
    `/bookings/${b.id}/checkout`,
    'POST',
    { tender: 'cash', amount_minor: '100000' },
    undefined,
    key,
  );
  assert.equal(first.status, 201);
  assert.equal(first.data.balance_minor, '150000');
  const duplicate = await owner.request(
    `/bookings/${b.id}/checkout`,
    'POST',
    { tender: 'cash', amount_minor: '100000' },
    undefined,
    key,
  );
  assert.equal(duplicate.data.payment_id, first.data.payment_id);
  const second = await owner.request(`/bookings/${b.id}/checkout`, 'POST', {
    tender: 'cash',
    amount_minor: '150000',
  });
  assert.equal(second.data.balance_minor, '0');
  const paid = (await owner.request('/state')).data.bookings.find((r: any) => r.id === b.id);
  assert.equal(paid.visit_status, 'CLOSED');
  assert.equal(paid.paid_minor, '250000');
  await assert.rejects(
    () =>
      db.query("UPDATE receipts SET checksum='changed' WHERE tenant_id=$1 AND id=$2", [
        TENANT,
        first.data.receipt_id,
      ]),
    /immutable/,
  );
  const refund = await owner.request(`/payments/${first.data.payment_id}/refunds`, 'POST', {
    amount_minor: '50000',
    reason: 'Customer satisfaction adjustment',
  });
  assert.equal(refund.status, 201);
  assert.equal(
    (
      await owner.request(`/payments/${first.data.payment_id}/refunds`, 'POST', {
        amount_minor: '60000',
        reason: 'Over refund prevented',
      })
    ).status,
    422,
  );
  const ledger = (
    await db.query(
      'SELECT transaction_id,SUM(amount_minor)::text AS balance FROM ledger_entries GROUP BY transaction_id',
    )
  ).rows;
  assert.ok(ledger.every((row) => row.balance === '0'));
  await assert.rejects(
    () =>
      transaction(async (tx) => {
        await tx.query(
          'INSERT INTO ledger_entries(tenant_id,id,transaction_id,account,amount_minor) VALUES($1,$2,$3,$4,$5)',
          [TENANT, id(), id(), 'cash', '100'],
        );
      }),
    /Unbalanced ledger/,
  );
});
test('stock is nonnegative and retry does not apply usage twice', async () => {
  const product = state.products[0],
    key = id(),
    body = { product_id: product.id, delta: -1, reason: 'Recorded service usage' };
  const first = await owner.request('/stock-adjustments', 'POST', body, product.version, key);
  assert.equal(first.status, 201);
  const retry = await owner.request('/stock-adjustments', 'POST', body, product.version, key);
  assert.equal(retry.data.on_hand, first.data.on_hand);
  const bad = await owner.request(
    '/stock-adjustments',
    'POST',
    { ...body, delta: -1000 },
    product.version + 1,
  );
  assert.equal(bad.status, 409);
});
test('rescheduling swaps atomically, rotates pass, and preserves old reservation on failure', async () => {
  const date = localDate(new Date(Date.now() + 5 * 86400000));
  const service = state.services.find((s: any) => s.name === 'Classic manicure');
  const q = (
    await owner.request('/availability/search', 'POST', {
      branch_id: BRANCH,
      service_ids: [service.id],
      date,
    })
  ).data[0];
  const h = (
    await owner.request('/booking-holds', 'POST', {
      quote_id: q.quote_id,
      plan_fingerprint: q.plan_fingerprint,
      customer_id: state.customers[3].id,
      accepted_policy: true,
    })
  ).data;
  const b = (await owner.request(`/booking-holds/${h.id}/confirm`, 'POST', {})).data;
  const oldPass = (await owner.request(`/bookings/${b.id}/pass`)).data;
  const replacement = (
    await owner.request('/availability/search', 'POST', {
      branch_id: BRANCH,
      service_ids: [service.id],
      date,
      earliest: '16:00',
      exclude_booking: b.id,
    })
  ).data[0];
  const moved = await owner.request(
    `/bookings/${b.id}/reschedule`,
    'POST',
    { quote_id: replacement.quote_id },
    b.version,
  );
  assert.equal(moved.status, 201);
  assert.notEqual(moved.data.starts_at, b.starts_at);
  assert.equal(moved.data.pass_version, b.pass_version + 1);
  const scan = await owner.request('/arrivals/scan', 'POST', { payload: oldPass.payload });
  assert.equal(scan.error.code, 'PASS_REVOKED');
  const newPass = (await owner.request(`/bookings/${b.id}/pass`)).data;
  assert.notEqual(newPass.payload, oldPass.payload);
});
test('public data excludes customer records and Gemini fails visibly when unconfigured', async () => {
  const publicClient = new Client();
  const list = await publicClient.request('/public/branches');
  assert.equal(list.status, 200);
  assert.ok(list.data.length === 2);
  assert.equal((await publicClient.request('/bookings')).status, 401);
  assert.equal(
    (await customer.request('/ai/booking-drafts', 'POST', { text: 'Tomorrow haircut' })).status,
    403,
  );
  if (!process.env.GEMINI_API_KEY)
    assert.equal(
      (await owner.request('/ai/booking-drafts', 'POST', { text: 'Kal haircut aur manicure' }))
        .error.code,
      'AI_NOT_CONFIGURED',
    );
});
test('forced PostgreSQL row policies deny cross-tenant reads and writes for the runtime role', async () => {
  const otherTenant = id(),
    otherBranch = id(),
    otherClient = id();
  await transaction(async (tx) => {
    await tx.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [
      otherTenant,
      'Isolation test tenant',
    ]);
    await tx.query('INSERT INTO branches(tenant_id,id,name) VALUES($1,$2,$3)', [
      otherTenant,
      otherBranch,
      'Private test branch',
    ]);
    await tx.query(
      'INSERT INTO customers(tenant_id,branch_id,id,name,phone) VALUES($1,$2,$3,$4,$5)',
      [otherTenant, otherBranch, otherClient, 'Other tenant private client', '+923009999999'],
    );
  }, otherTenant);
  await transaction(async (tx) => {
    await tx.query('SET LOCAL ROLE aurelle_app');
    const visible = (await tx.query('SELECT tenant_id,id FROM customers')).rows;
    assert.ok(visible.length > 0);
    assert.ok(visible.every((c) => c.tenant_id === TENANT));
    assert.equal(
      (await tx.query('SELECT * FROM customers WHERE id=$1', [otherClient])).rows.length,
      0,
    );
  });
  await assert.rejects(
    () =>
      transaction(async (tx) => {
        await tx.query('SET LOCAL ROLE aurelle_app');
        await tx.query(
          'INSERT INTO customers(tenant_id,branch_id,id,name,phone) VALUES($1,$2,$3,$4,$5)',
          [otherTenant, otherBranch, id(), 'Forbidden client', '+923008888888'],
        );
      }),
    /row-level security/,
  );
  const row = (await owner.request('/state')).data;
  assert.ok(!row.customers.some((c: any) => c.id === otherClient));
});
test('a verified customer can book another branch without gaining workforce visibility', async () => {
  const services = (await customer.request(`/public/branches/${SECOND_BRANCH}/services`)).data;
  const q = (
    await customer.request('/availability/search', 'POST', {
      branch_id: SECOND_BRANCH,
      service_ids: [services[0].id],
      date: localDate(new Date(Date.now() + 8 * 86400000)),
    })
  ).data[0];
  const held = await customer.request('/booking-holds', 'POST', {
    quote_id: q.quote_id,
    plan_fingerprint: q.plan_fingerprint,
    accepted_policy: true,
    source: 'customer',
  });
  assert.equal(held.status, 201);
  assert.equal(held.data.branch_id, SECOND_BRANCH);
  const confirmed = await customer.request(`/booking-holds/${held.data.id}/confirm`, 'POST', {});
  assert.equal(confirmed.data.status, 'CONFIRMED');
  assert.equal((await customer.request(`/bookings/${held.data.id}/pass`)).status, 200);
  assert.equal((await customer.request('/state')).status, 403);
});
test('local acknowledged writes survive a clean stop and snapshot reload', async () => {
  await closeDB();
  const previousFile = process.env.DATA_FILE;
  const file = resolve('.data', `persistence-test-${id()}.tar.gz`);
  process.env.DATA_FILE = file;
  await initDB();
  const tid = id();
  await transaction(async (tx) => {
    await tx.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [
      tid,
      'Persistence contract verified',
    ]);
  }, tid);
  assert.ok((await stat(file)).size > 1000);
  await closeDB();
  await initDB();
  assert.equal(
    (await one(db, 'SELECT name FROM tenants WHERE id=$1', [tid]))!.name,
    'Persistence contract verified',
  );
  await closeDB();
  await unlink(file);
  await unlink(file + '.previous').catch(() => {});
  if (previousFile) process.env.DATA_FILE = previousFile;
  else delete process.env.DATA_FILE;
});
