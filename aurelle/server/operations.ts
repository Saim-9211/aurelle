import { one, type SQL } from './db.ts';
import {
  id,
  token,
  hash,
  event,
  Problem,
  bookingFor,
  reserve,
  checkVersion,
  expireHolds,
  findPlans,
  localTime,
  type Scope,
  type Plan,
} from './domain.ts';
export async function createQuote(tx: SQL, s: Scope, plan: Plan, customerId?: string) {
  const quoteId = id(),
    fingerprint = hash(JSON.stringify(plan)),
    expires = new Date(Date.now() + 30000);
  await tx.query(
    'INSERT INTO quotes(tenant_id,branch_id,id,actor_id,customer_id,fingerprint,plan,total_minor,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      s.tenant,
      s.branch,
      quoteId,
      s.role === 'public' ? null : s.actor,
      customerId || null,
      fingerprint,
      plan,
      plan.total_minor,
      expires,
    ],
  );
  return {
    ...plan,
    quote_id: quoteId,
    plan_fingerprint: fingerprint,
    valid_until: expires.toISOString(),
  };
}
export async function createHold(tx: SQL, s: Scope, input: any) {
  await expireHolds(tx, s);
  const quote = await one(
    tx,
    "SELECT * FROM quotes WHERE tenant_id=$1 AND ($4='customer' OR branch_id=$2) AND id=$3",
    [s.tenant, s.branch, input.quote_id, s.role],
  );
  if (!quote || new Date(quote.expires_at) < new Date())
    throw new Problem(
      409,
      'QUOTE_EXPIRED',
      'These times have expired. Search again for current availability.',
    );
  if (
    (quote.actor_id && quote.actor_id !== s.actor) ||
    quote.fingerprint !== input.plan_fingerprint
  )
    throw new Problem(409, 'INVALID_QUOTE', 'Please select a current availability option.');
  if (s.role === 'customer') s.branch = quote.branch_id;
  const customerId = s.role === 'customer' ? s.customer : input.customer_id;
  const customer = await one(tx, 'SELECT * FROM customers WHERE tenant_id=$1 AND id=$2', [
    s.tenant,
    customerId,
  ]);
  if (!customer)
    throw new Problem(
      422,
      'CUSTOMER_REQUIRED',
      'Choose a client before confirming this appointment.',
    );
  if (!input.accepted_policy)
    throw new Problem(422, 'POLICY_REQUIRED', 'Accept the booking policy to continue.');
  const existing = await one(
    tx,
    "SELECT id FROM bookings WHERE tenant_id=$1 AND branch_id=$2 AND customer_id=$3 AND status='HELD'",
    [s.tenant, s.branch, customerId],
  );
  if (existing)
    throw new Problem(
      409,
      'ACTIVE_HOLD',
      'This client already has a held appointment. Confirm or release it first.',
    );
  await tx.query(
    "INSERT INTO assets(tenant_id,branch_id,id,kind,name) VALUES($1,$2,$3,'recipient','Recipient') ON CONFLICT(tenant_id,id) DO NOTHING",
    [s.tenant, s.branch, customerId],
  );
  const branch = await one(tx, 'SELECT * FROM branches WHERE tenant_id=$1 AND id=$2', [
    s.tenant,
    s.branch,
  ]);
  if (branch!.version !== quote.plan.policy_version)
    throw new Problem(
      409,
      'POLICY_CHANGED',
      'The booking policy changed. Review fresh availability.',
    );
  const bookingId = id(),
    reference = `AU-${id().slice(0, 8).toUpperCase()}`,
    expiry = new Date(Date.now() + 300000),
    pass = token();
  await tx.query(
    "INSERT INTO bookings(tenant_id,branch_id,id,customer_id,reference,source,status,starts_at,ends_at,total_minor,plan,policy,hold_expires_at,pass_hash,pass_token) VALUES($1,$2,$3,$4,$5,$6,'HELD',$7,$8,$9,$10,$11,$12,$13,$14)",
    [
      s.tenant,
      s.branch,
      bookingId,
      customerId,
      reference,
      input.source || 'staff',
      quote.plan.starts_at,
      quote.plan.ends_at,
      quote.total_minor,
      quote.plan,
      branch!.data,
      expiry,
      hash(pass),
      pass,
    ],
  );
  await reserve(tx, s, bookingId, customerId, quote.plan);
  for (const [sequence, step] of (quote.plan as Plan).steps.entries())
    await tx.query(
      'INSERT INTO steps(tenant_id,branch_id,id,booking_id,sequence,data) VALUES($1,$2,$3,$4,$5,$6)',
      [s.tenant, s.branch, id(), bookingId, sequence, step],
    );
  await event(tx, s, 'booking.held', bookingId);
  return bookingFor(tx, s, bookingId);
}
export async function confirmHold(tx: SQL, s: Scope, bookingId: string) {
  await expireHolds(tx, s);
  const b = await bookingFor(tx, s, bookingId);
  if (b.status === 'CONFIRMED') return b;
  if (b.status !== 'HELD' || new Date(b.hold_expires_at) <= new Date())
    throw new Problem(409, 'HOLD_EXPIRED', 'This hold has expired. Search for availability again.');
  await tx.query(
    "UPDATE bookings SET status='CONFIRMED',hold_expires_at=null,version=version+1 WHERE tenant_id=$1 AND id=$2",
    [s.tenant, bookingId],
  );
  await tx.query(
    "UPDATE reservations SET kind='confirmed' WHERE tenant_id=$1 AND booking_id=$2 AND active=true",
    [s.tenant, bookingId],
  );
  await event(tx, s, 'booking.confirmed', bookingId);
  const confirmed = await bookingFor(tx, s, bookingId);
  await scheduleMessages(tx, s, confirmed);
  return confirmed;
}
export async function scheduleMessages(tx: SQL, s: Scope, b: any) {
  for (const [kind, when] of [
    ['confirmation', new Date()],
    ['reminder_24h', new Date(+new Date(b.starts_at) - 24 * 3600000)],
    ['reminder_2h', new Date(+new Date(b.starts_at) - 2 * 3600000)],
  ] as const) {
    if (kind !== 'confirmation' && when < new Date()) continue;
    await tx.query(
      'INSERT INTO scheduled_jobs(tenant_id,branch_id,id,booking_id,booking_version,kind,run_after) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      [s.tenant, s.branch, id(), b.id, b.pass_version, kind, when],
    );
  }
}
export async function arrive(tx: SQL, s: Scope, bookingId: string, method: string) {
  const b = await bookingFor(tx, s, bookingId);
  if (b.arrived_at) return b;
  if (b.status !== 'CONFIRMED')
    throw new Problem(409, 'BOOKING_NOT_ACTIVE', 'Only a confirmed appointment can be checked in.');
  if (!['pass', 'phone', 'in_person'].includes(method))
    throw new Problem(422, 'VERIFICATION_REQUIRED', 'Choose how you verified the client.');
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
  if (
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date(b.starts_at)) !==
    date
  )
    throw new Problem(409, 'ARRIVAL_DATE', 'Check-in is available on the appointment date.');
  await tx.query(
    "UPDATE bookings SET arrived_at=now(),visit_status='WAITING',version=version+1 WHERE tenant_id=$1 AND id=$2",
    [s.tenant, bookingId],
  );
  await tx.query(
    "UPDATE steps SET state='READY',version=version+1 WHERE tenant_id=$1 AND booking_id=$2 AND sequence=(SELECT MIN(sequence) FROM steps WHERE tenant_id=$1 AND booking_id=$2 AND state='PLANNED') AND state='PLANNED'",
    [s.tenant, bookingId],
  );
  await event(tx, s, 'arrival.verified', bookingId, { method });
  return bookingFor(tx, s, bookingId);
}
export async function transitionStep(
  tx: SQL,
  s: Scope,
  stepId: string,
  action: string,
  version: string | undefined,
  input: any,
) {
  const step = await one(tx, 'SELECT * FROM steps WHERE tenant_id=$1 AND branch_id=$2 AND id=$3', [
    s.tenant,
    s.branch,
    stepId,
  ]);
  if (!step) throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Service step not found.');
  checkVersion(step, version);
  const b = await bookingFor(tx, s, step.booking_id);
  if (s.role === 'professional') {
    const pro = await one(
      tx,
      "SELECT id FROM professionals WHERE tenant_id=$1 AND id=$2 AND data->>'account_id'=$3",
      [s.tenant, step.data.professional_id, s.actor],
    );
    if (!pro)
      throw new Problem(403, 'CAPABILITY_REQUIRED', 'You can only update your assigned services.');
  }
  const previous = await one(
    tx,
    "SELECT id FROM steps WHERE tenant_id=$1 AND booking_id=$2 AND sequence<$3 AND state NOT IN ('COMPLETED','CANCELLED')",
    [s.tenant, b.id, step.sequence],
  );
  if (action === 'call') {
    if (step.state !== 'READY')
      throw new Problem(409, 'STEP_NOT_READY', 'This service is not ready to be called.');
    if (new Date(step.data.starts_at).getTime() > Date.now() + 5 * 60000)
      throw new Problem(
        409,
        'STEP_NOT_DUE',
        'This visit is early. Its reserved service time has not arrived yet.',
      );
    for (const asset of [
      step.data.resource_id,
      ...(step.data.staff ? [step.data.professional_id] : []),
    ])
      if (
        await one(
          tx,
          'SELECT id FROM occupancies WHERE tenant_id=$1 AND asset_id=$2 AND ended_at IS NULL AND step_id<>$3',
          [s.tenant, asset, stepId],
        )
      )
        throw new Problem(
          409,
          'RESOURCE_OCCUPIED',
          'The professional or station is still occupied.',
        );
    await tx.query(
      "UPDATE steps SET state='CALLED',called_until=now()+interval '2 minutes',version=version+1 WHERE tenant_id=$1 AND id=$2",
      [s.tenant, stepId],
    );
  } else if (action === 'start') {
    if (!b.arrived_at || previous || !['CALLED', 'READY'].includes(step.state))
      throw new Problem(
        409,
        'STEP_NOT_READY',
        'Check the client in and complete all previous steps first.',
      );
    if (!input.preparation_confirmed)
      throw new Problem(
        422,
        'PREPARATION_REQUIRED',
        'Confirm service preparation and client consent before starting.',
      );
    if (new Date(step.data.starts_at).getTime() > Date.now() + 5 * 60000)
      throw new Problem(
        409,
        'STEP_NOT_DUE',
        'This visit is early. Please wait until its reserved service time.',
      );
    if (step.state === 'CALLED' && new Date(step.called_until) < new Date())
      throw new Problem(
        409,
        'CALL_EXPIRED',
        'The call expired. Requeue and call the client again.',
      );
    const pro = await one(
      tx,
      'SELECT * FROM professionals WHERE tenant_id=$1 AND id=$2 AND active=true',
      [s.tenant, step.data.professional_id],
    );
    if (!pro || (pro.data.skills || []).includes(step.data.category) === false)
      throw new Problem(
        409,
        'PROFESSIONAL_UNAVAILABLE',
        'The assigned professional is unavailable or no longer qualified.',
      );
    const currentTime = localTime();
    if (
      step.data.staff &&
      (currentTime < pro.data.start ||
        currentTime >= pro.data.end ||
        pro.data.breaks?.some((b: any) => currentTime >= b.start && currentTime < b.end))
    )
      throw new Problem(
        409,
        'PROFESSIONAL_OFF_DUTY',
        'The assigned professional is off duty or on a scheduled break.',
      );
    for (const asset of [
      step.data.resource_id,
      ...(step.data.staff ? [step.data.professional_id] : []),
    ]) {
      const busy = await one(
        tx,
        'SELECT id,step_id FROM occupancies WHERE tenant_id=$1 AND asset_id=$2 AND ended_at IS NULL',
        [s.tenant, asset],
      );
      if (busy?.step_id === stepId) continue;
      if (busy)
        throw new Problem(
          409,
          'RESOURCE_OCCUPIED',
          'The professional or station is still serving another client. Complete that service first.',
        );
      await tx.query('INSERT INTO occupancies(tenant_id,id,asset_id,step_id) VALUES($1,$2,$3,$4)', [
        s.tenant,
        id(),
        asset,
        stepId,
      ]);
    }
    await tx.query(
      "UPDATE steps SET state='ACTIVE',actual_start=now(),version=version+1 WHERE tenant_id=$1 AND id=$2",
      [s.tenant, stepId],
    );
    await tx.query(
      "UPDATE bookings SET visit_status='IN_SERVICE',version=version+1 WHERE tenant_id=$1 AND id=$2",
      [s.tenant, b.id],
    );
  } else if (action === 'complete') {
    if (step.state !== 'ACTIVE')
      throw new Problem(409, 'STEP_NOT_ACTIVE', 'Start the service before completing it.');
    if (
      step.data.staff === false &&
      step.data.phase.toLowerCase().includes('processing') &&
      new Date(step.actual_start).getTime() + step.data.duration * 60000 > Date.now()
    )
      throw new Problem(409, 'PROCESSING_INCOMPLETE', 'The processing time has not elapsed yet.');
    await tx.query(
      "UPDATE steps SET state='COMPLETED',actual_end=now(),version=version+1 WHERE tenant_id=$1 AND id=$2",
      [s.tenant, stepId],
    );
    await tx.query(
      'UPDATE occupancies SET ended_at=now() WHERE tenant_id=$1 AND step_id=$2 AND ended_at IS NULL',
      [s.tenant, stepId],
    );
    const next = await one(
      tx,
      "SELECT * FROM steps WHERE tenant_id=$1 AND booking_id=$2 AND sequence>$3 AND state='PLANNED' ORDER BY sequence LIMIT 1",
      [s.tenant, b.id, step.sequence],
    );
    if (next) {
      if (next.data.resource_id === step.data.resource_id)
        await tx.query(
          'INSERT INTO occupancies(tenant_id,id,asset_id,step_id) VALUES($1,$2,$3,$4)',
          [s.tenant, id(), next.data.resource_id, next.id],
        );
      await tx.query(
        "UPDATE steps SET state='READY',version=version+1 WHERE tenant_id=$1 AND id=$2",
        [s.tenant, next.id],
      );
      await tx.query(
        "UPDATE bookings SET visit_status='WAITING',version=version+1 WHERE tenant_id=$1 AND id=$2",
        [s.tenant, b.id],
      );
    } else {
      await tx.query(
        "UPDATE bookings SET status='FULFILLED',visit_status='CHECKOUT',version=version+1 WHERE tenant_id=$1 AND id=$2",
        [s.tenant, b.id],
      );
      await tx.query('UPDATE reservations SET active=false WHERE tenant_id=$1 AND booking_id=$2', [
        s.tenant,
        b.id,
      ]);
    }
  } else if (action === 'delay') {
    if (!['ACTIVE', 'CALLED', 'READY'].includes(step.state))
      throw new Problem(409, 'STEP_NOT_READY', 'Only active or ready work can be delayed.');
    if (
      !Number.isInteger(input.minutes) ||
      input.minutes < 5 ||
      input.minutes > 120 ||
      !input.reason
    )
      throw new Problem(422, 'INVALID_DELAY', 'Enter 5–120 minutes and a reason.');
    await tx.query(
      'UPDATE steps SET delay_minutes=delay_minutes+$3,version=version+1 WHERE tenant_id=$1 AND id=$2',
      [s.tenant, stepId, input.minutes],
    );
  } else if (action === 'requeue') {
    if (!['CALLED', 'TEMPORARILY_ABSENT'].includes(step.state))
      throw new Problem(
        409,
        'INVALID_TRANSITION',
        'Only a called or absent client can be requeued.',
      );
    await tx.query(
      "UPDATE steps SET state='READY',called_until=null,version=version+1 WHERE tenant_id=$1 AND id=$2",
      [s.tenant, stepId],
    );
  } else if (action === 'mark-absent') {
    if (step.state !== 'CALLED')
      throw new Problem(
        409,
        'INVALID_TRANSITION',
        'Call the client before marking them temporarily absent.',
      );
    await tx.query(
      "UPDATE steps SET state='TEMPORARILY_ABSENT',version=version+1 WHERE tenant_id=$1 AND id=$2",
      [s.tenant, stepId],
    );
  } else throw new Problem(404, 'UNKNOWN_ACTION', 'Unknown service action.');
  await event(
    tx,
    s,
    `service_step.${action}`,
    stepId,
    action === 'delay' ? { minutes: input.minutes, reason: input.reason } : {},
  );
  return one(tx, 'SELECT * FROM steps WHERE tenant_id=$1 AND id=$2', [s.tenant, stepId]);
}
export async function checkout(tx: SQL, s: Scope, bookingId: string, input: any) {
  const b = await bookingFor(tx, s, bookingId);
  if (b.status !== 'FULFILLED')
    throw new Problem(
      409,
      'SERVICES_INCOMPLETE',
      'Complete all service and station-reset steps before checkout.',
    );
  let invoice = await one(tx, 'SELECT * FROM invoices WHERE tenant_id=$1 AND booking_id=$2', [
    s.tenant,
    b.id,
  ]);
  if (!invoice) {
    const lines = b.plan.service_ids.map((sid: string) => {
      const st = b.plan.steps.find((x: any) => x.service_id === sid);
      return {
        name: st.service_name,
        amount_minor: st.price_minor,
        professional_id: st.professional_id,
      };
    });
    const invoiceId = id();
    const branch = await one(tx, 'SELECT * FROM branches WHERE tenant_id=$1 AND id=$2', [
      s.tenant,
      s.branch,
    ]);
    const snapshot = {
      reference: b.reference,
      customer_name: b.customer_name,
      lines,
      total_minor: String(b.total_minor),
      currency: 'PKR',
      branch_name: branch!.name,
      address: branch!.data.address,
      tax_minor: '0',
    };
    await tx.query(
      'INSERT INTO invoices(tenant_id,branch_id,id,booking_id,number,total_minor,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        s.tenant,
        s.branch,
        invoiceId,
        b.id,
        `INV-${invoiceId.slice(0, 8).toUpperCase()}`,
        b.total_minor,
        snapshot,
      ],
    );
    invoice = await one(tx, 'SELECT * FROM invoices WHERE tenant_id=$1 AND id=$2', [
      s.tenant,
      invoiceId,
    ]);
  }
  const payments = (
    await tx.query('SELECT * FROM payments WHERE tenant_id=$1 AND invoice_id=$2', [
      s.tenant,
      invoice.id,
    ])
  ).rows;
  const paid = payments.reduce((a, p) => a + BigInt(p.amount_minor), 0n);
  const due = BigInt(invoice.total_minor) - paid;
  const amount = BigInt(input.amount_minor || due.toString());
  if (amount <= 0n || amount > due)
    throw new Problem(
      422,
      'INVALID_AMOUNT',
      'The payment must be positive and cannot exceed the balance due.',
    );
  if (
    input.tender === 'bank_verified' &&
    (!input.evidence || !['owner', 'manager'].includes(s.role))
  )
    throw new Problem(
      403,
      'BANK_VERIFICATION_REQUIRED',
      'A manager must verify a bank transfer and record the bank reference.',
    );
  const paymentId = id();
  await tx.query(
    'INSERT INTO payments(tenant_id,branch_id,id,invoice_id,amount_minor,tender,evidence) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      s.tenant,
      s.branch,
      paymentId,
      invoice.id,
      amount.toString(),
      input.tender || 'cash',
      input.evidence || null,
    ],
  );
  for (const [account, value] of [
    [input.tender === 'bank_verified' ? 'bank' : 'cash', amount],
    ['service_revenue', -amount],
  ] as const)
    await tx.query(
      'INSERT INTO ledger_entries(tenant_id,id,transaction_id,account,amount_minor) VALUES($1,$2,$3,$4,$5)',
      [s.tenant, id(), paymentId, account, value.toString()],
    );
  const receiptId = id();
  const receipt = {
    ...invoice.snapshot,
    invoice_id: invoice.id,
    invoice_number: invoice.number,
    payment_id: paymentId,
    paid_minor: amount.toString(),
    total_paid_minor: (paid + amount).toString(),
    balance_minor: (due - amount).toString(),
    tender: input.tender || 'cash',
    issued_at: new Date().toISOString(),
  };
  await tx.query(
    'INSERT INTO receipts(tenant_id,id,invoice_id,payment_id,snapshot,checksum) VALUES($1,$2,$3,$4,$5,$6)',
    [s.tenant, receiptId, invoice.id, paymentId, receipt, hash(JSON.stringify(receipt))],
  );
  if (amount === due)
    await tx.query(
      "UPDATE bookings SET visit_status='CLOSED',version=version+1 WHERE tenant_id=$1 AND id=$2",
      [s.tenant, b.id],
    );
  await event(tx, s, 'payment.captured', paymentId, {
    amount_minor: amount.toString(),
    tender: input.tender || 'cash',
  });
  return { receipt_id: receiptId, ...receipt };
}
export async function reschedule(
  tx: SQL,
  s: Scope,
  bookingId: string,
  input: any,
  version: string | undefined,
) {
  const b = await bookingFor(tx, s, bookingId);
  checkVersion(b, version);
  if (b.status !== 'CONFIRMED' || b.arrived_at)
    throw new Problem(
      409,
      'CANNOT_RESCHEDULE',
      'Only unarrived, confirmed appointments can be rescheduled.',
    );
  const quote = await one(
    tx,
    'SELECT * FROM quotes WHERE tenant_id=$1 AND branch_id=$2 AND id=$3',
    [s.tenant, s.branch, input.quote_id],
  );
  if (!quote || new Date(quote.expires_at) < new Date() || quote.actor_id !== s.actor)
    throw new Problem(409, 'QUOTE_EXPIRED', 'Search again for a current quote.');
  if (
    JSON.stringify(quote.plan.service_ids) !== JSON.stringify(b.plan.service_ids) ||
    BigInt(quote.total_minor) !== BigInt(b.total_minor)
  )
    throw new Problem(
      409,
      'PRICE_CHANGED',
      'Rescheduling requires the same service scope and price. Ask reception to review changes.',
    );
  // Old capacity stays reserved until this transaction; rollback restores it on any conflict.
  await tx.query('UPDATE reservations SET active=false WHERE tenant_id=$1 AND booking_id=$2', [
    s.tenant,
    b.id,
  ]);
  await reserve(tx, s, b.id, b.customer_id, quote.plan, 'confirmed');
  await tx.query(
    "UPDATE steps SET state='CANCELLED',version=version+1 WHERE tenant_id=$1 AND booking_id=$2",
    [s.tenant, b.id],
  );
  const max = await one(
    tx,
    'SELECT MAX(sequence) AS n FROM steps WHERE tenant_id=$1 AND booking_id=$2',
    [s.tenant, b.id],
  );
  for (const [i, step] of (quote.plan as Plan).steps.entries())
    await tx.query(
      'INSERT INTO steps(tenant_id,branch_id,id,booking_id,sequence,data) VALUES($1,$2,$3,$4,$5,$6)',
      [s.tenant, s.branch, id(), b.id, Number(max!.n) + 1 + i, step],
    );
  const pass = token();
  await tx.query(
    'UPDATE bookings SET plan=$3,starts_at=$4,ends_at=$5,pass_hash=$6,pass_token=$7,pass_version=pass_version+1,version=version+1 WHERE tenant_id=$1 AND id=$2',
    [s.tenant, b.id, quote.plan, quote.plan.starts_at, quote.plan.ends_at, hash(pass), pass],
  );
  await event(tx, s, 'booking.rescheduled', b.id);
  const updated = await bookingFor(tx, s, b.id);
  await scheduleMessages(tx, s, updated);
  return updated;
}
