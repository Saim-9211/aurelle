import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { one, type SQL } from './db.ts';
export class Problem extends Error {
  constructor(
    public status: number,
    public code: string,
    detail: string,
  ) {
    super(detail);
  }
}
export const id = () => randomUUID();
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export const localDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
export const localTime = (d = new Date()) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
export function at(date: string, time: string) {
  return new Date(`${date}T${time}:00+05:00`);
}
export const addMinutes = (date: Date, n: number) => new Date(date.getTime() + n * 60000);
export function phone(s: string) {
  const digits = s.replace(/\D/g, '');
  const normalized = digits.startsWith('0') ? '92' + digits.slice(1) : digits;
  if (!/^923\d{9}$/.test(normalized))
    throw new Problem(
      422,
      'INVALID_PHONE',
      'Enter a Pakistan mobile number, for example 0300 1234567.',
    );
  return '+' + normalized;
}
export type Scope = {
  tenant: string;
  branch: string;
  actor: string;
  role: string;
  customer?: string;
  adult?: boolean;
};
export type Phase = { name: string; minutes: number; staff: boolean; resource: string };
export type PlanStep = {
  service_id: string;
  service_name: string;
  phase: string;
  duration: number;
  professional_id: string;
  professional_name: string;
  resource_id: string;
  resource_name: string;
  staff: boolean;
  starts_at: string;
  ends_at: string;
  price_minor: string;
  category: string;
  cleanup?: boolean;
};
export type Plan = {
  steps: PlanStep[];
  starts_at: string;
  ends_at: string;
  total_minor: string;
  service_ids: string[];
  policy_version: number;
};
export function requireRole(scope: Scope, roles: string[]) {
  if (!roles.includes(scope.role))
    throw new Problem(403, 'CAPABILITY_REQUIRED', 'Your role does not have access to this action.');
}
export function checkVersion(row: any, version: string | undefined) {
  if (!version)
    throw new Problem(428, 'VERSION_REQUIRED', 'Refresh this record before making a change.');
  if (String(row.version) !== version.replaceAll('"', ''))
    throw new Problem(
      412,
      'VERSION_CONFLICT',
      'This record changed on another device. Refresh and review it again.',
    );
}
export async function expireHolds(tx: SQL, scope: Scope) {
  await tx.query(
    "UPDATE reservations SET active=false WHERE tenant_id=$1 AND booking_id IN (SELECT id FROM bookings WHERE tenant_id=$1 AND status='HELD' AND hold_expires_at<=now())",
    [scope.tenant],
  );
  await tx.query(
    "UPDATE bookings SET status='EXPIRED',version=version+1 WHERE tenant_id=$1 AND status='HELD' AND hold_expires_at<=now()",
    [scope.tenant],
  );
}
export async function event(tx: SQL, s: Scope, type: string, target: string, data: any = {}) {
  await tx.query(
    'INSERT INTO audit_events(tenant_id,branch_id,id,actor_id,action,target_id,data) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [s.tenant, s.branch, id(), s.actor, type, target, data],
  );
  await tx.query(
    'INSERT INTO outbox_events(tenant_id,branch_id,id,type,target_id) VALUES($1,$2,$3,$4,$5)',
    [s.tenant, s.branch, id(), type, target],
  );
}
export async function command(
  tx: SQL,
  s: Scope,
  operation: string,
  key: string | undefined,
  body: any,
  run: () => Promise<any>,
) {
  if (!key || key.length < 8 || key.length > 150)
    throw new Problem(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid request key is required.');
  const requestHash = hash(JSON.stringify(body));
  const previous = await one(
    tx,
    'SELECT * FROM command_results WHERE tenant_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4',
    [s.tenant, s.actor, operation, key],
  );
  if (previous) {
    if (previous.request_hash !== requestHash)
      throw new Problem(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'This request key was already used with different details.',
      );
    return previous.result;
  }
  const result = await run();
  await tx.query(
    'INSERT INTO command_results(tenant_id,actor_id,operation,key,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)',
    [s.tenant, s.actor, operation, key, requestHash, result],
  );
  return result;
}
export async function findPlans(
  tx: SQL,
  s: Scope,
  input: {
    service_ids: string[];
    date: string;
    earliest?: string;
    professional_id?: string;
    customer_id?: string;
    exclude_booking?: string;
    budget_minor?: string;
  },
): Promise<Plan[]> {
  if (
    input.service_ids.length < 1 ||
    input.service_ids.length > 6 ||
    new Set(input.service_ids).size !== input.service_ids.length
  )
    throw new Problem(422, 'INVALID_SERVICES', 'Select between one and six different services.');
  const dateStart = at(input.date, '00:00');
  const dayDiff = (dateStart.getTime() - at(localDate(), '00:00').getTime()) / 86400000;
  if (!Number.isFinite(dateStart.getTime()) || dayDiff < 0 || dayDiff > 90)
    throw new Problem(422, 'INVALID_DATE', 'Choose a date within the next 90 days.');
  const branch = await one(tx, 'SELECT * FROM branches WHERE tenant_id=$1 AND id=$2', [
    s.tenant,
    s.branch,
  ]);
  if (!branch) throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Branch not found.');
  const services = (
    await tx.query(
      'SELECT * FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=true AND id=ANY($3::uuid[])',
      [s.tenant, s.branch, input.service_ids],
    )
  ).rows;
  if (services.length !== input.service_ids.length)
    throw new Problem(422, 'SERVICE_UNAVAILABLE', 'One of these services is no longer available.');
  const pros = (
    await tx.query(
      'SELECT * FROM professionals WHERE tenant_id=$1 AND branch_id=$2 AND active=true ORDER BY name',
      [s.tenant, s.branch],
    )
  ).rows;
  const resources = (
    await tx.query(
      "SELECT * FROM assets WHERE tenant_id=$1 AND branch_id=$2 AND kind='resource' ORDER BY id",
      [s.tenant, s.branch],
    )
  ).rows;
  const busy = (
    await tx.query(
      "SELECT asset_id,lower(period) AS starts_at,upper(period) AS ends_at FROM reservations WHERE tenant_id=$1 AND active=true AND period && tstzrange($2,$3,'[)') AND ($4::uuid IS NULL OR booking_id<>$4)",
      [s.tenant, dateStart, addMinutes(dateStart, 1440), input.exclude_booking || null],
    )
  ).rows;
  const occupied = (
    await tx.query('SELECT asset_id FROM occupancies WHERE tenant_id=$1 AND ended_at IS NULL', [
      s.tenant,
    ])
  ).rows;
  const free = (asset: string, start: Date, end: Date) =>
    !busy.some(
      (b) => b.asset_id === asset && new Date(b.starts_at) < end && new Date(b.ends_at) > start,
    ) &&
    !(
      dateStart.toDateString() === at(localDate(), '00:00').toDateString() &&
      start < addMinutes(new Date(), 15) &&
      occupied.some((b) => b.asset_id === asset)
    );
  const total = services.reduce((n, svc) => n + BigInt(svc.price_minor), 0n);
  if (input.budget_minor && total > BigInt(input.budget_minor)) return [];
  const opening = branch.data.open || '10:00',
    closing = branch.data.close || '20:00';
  const day = new Date(`${input.date}T12:00:00+05:00`).getUTCDay();
  if ((branch.data.closed_days || []).includes(day)) return [];
  const begin = at(
      input.date,
      input.earliest && input.earliest > opening ? input.earliest : opening,
    ),
    end = at(input.date, closing);
  const plans: Plan[] = [];
  for (let start = begin; start < end && plans.length < 20; start = addMinutes(start, 15)) {
    if (start < new Date()) continue;
    let cursor = start;
    const steps: PlanStep[] = [];
    let feasible = true;
    for (const sid of input.service_ids) {
      const svc = services.find((x) => x.id === sid)!;
      const phases: Phase[] = svc.data.phases || [
        { name: svc.name, minutes: svc.duration, staff: true, resource: svc.data.resource },
      ];
      const serviceEnd = addMinutes(
        cursor,
        phases.reduce((n, p) => n + p.minutes, 0),
      );
      const candidates = pros.filter(
        (p) =>
          (p.data.skills || []).includes(svc.category) &&
          (!input.professional_id || p.id === input.professional_id) &&
          !(p.data.off_days || []).includes(day),
      );
      let assigned = false;
      for (const pro of candidates) {
        const candidateSteps: PlanStep[] = [];
        let phaseStart = cursor,
          valid = true;
        for (const phase of phases) {
          const phaseEnd = addMinutes(phaseStart, phase.minutes);
          const shiftStart = at(input.date, pro.data.start || opening),
            shiftEnd = at(input.date, pro.data.end || closing);
          const onBreak = (pro.data.breaks || []).some(
            (b: { start: string; end: string }) =>
              at(input.date, b.start) < phaseEnd && at(input.date, b.end) > phaseStart,
          );
          if (
            phase.staff &&
            (phaseStart < shiftStart ||
              phaseEnd > shiftEnd ||
              onBreak ||
              !free(pro.id, phaseStart, phaseEnd))
          ) {
            valid = false;
            break;
          }
          const resource = resources.find(
            (r) => r.resource_type === phase.resource && free(r.id, phaseStart, phaseEnd),
          );
          if (!resource || (input.customer_id && !free(input.customer_id, phaseStart, phaseEnd))) {
            valid = false;
            break;
          }
          candidateSteps.push({
            service_id: svc.id,
            service_name: svc.name,
            phase: phase.name,
            duration: phase.minutes,
            professional_id: pro.id,
            professional_name: pro.name,
            resource_id: resource.id,
            resource_name: resource.name,
            staff: phase.staff,
            starts_at: phaseStart.toISOString(),
            ends_at: phaseEnd.toISOString(),
            price_minor: String(svc.price_minor),
            category: svc.category,
          });
          phaseStart = phaseEnd;
        }
        if (valid) {
          steps.push(...candidateSteps);
          assigned = true;
          break;
        }
      }
      if (!assigned || serviceEnd > end) {
        feasible = false;
        break;
      }
      cursor = serviceEnd;
    }
    if (feasible)
      plans.push({
        steps,
        starts_at: start.toISOString(),
        ends_at: cursor.toISOString(),
        total_minor: total.toString(),
        service_ids: input.service_ids,
        policy_version: branch.version,
      });
  }
  return plans;
}
export async function reserve(
  tx: SQL,
  s: Scope,
  bookingId: string,
  customerId: string,
  plan: Plan,
  kind = 'hold',
) {
  const intervals = new Map<string, { start: Date; end: Date }[]>();
  function push(asset: string, start: string, end: string) {
    const list = intervals.get(asset) || [];
    list.push({ start: new Date(start), end: new Date(end) });
    intervals.set(asset, list);
  }
  for (const step of plan.steps) {
    if (step.staff) push(step.professional_id, step.starts_at, step.ends_at);
    push(step.resource_id, step.starts_at, step.ends_at);
  }
  push(customerId, plan.starts_at, plan.ends_at);
  for (const [asset, list] of intervals) {
    list.sort((a, b) => +a.start - +b.start);
    const merged: typeof list = [];
    for (const item of list) {
      const last = merged.at(-1);
      if (last && item.start <= last.end) {
        if (item.end > last.end) last.end = item.end;
      } else merged.push({ ...item });
    }
    for (const item of merged)
      await tx.query(
        "INSERT INTO reservations(tenant_id,id,branch_id,asset_id,booking_id,period,kind) VALUES($1,$2,$3,$4,$5,tstzrange($6,$7,'[)'),$8)",
        [s.tenant, id(), s.branch, asset, bookingId, item.start, item.end, kind],
      );
  }
}
export async function bookingFor(tx: SQL, s: Scope, bookingId: string) {
  const row = await one(
    tx,
    "SELECT b.*,c.name AS customer_name,c.phone AS customer_phone FROM bookings b JOIN customers c ON c.tenant_id=b.tenant_id AND c.id=b.customer_id WHERE b.tenant_id=$1 AND ($4='customer' OR b.branch_id=$2) AND b.id=$3",
    [s.tenant, s.branch, bookingId, s.role],
  );
  if (!row || (s.role === 'customer' && row.customer_id !== s.customer))
    throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Appointment not found.');
  if (s.role === 'customer') s.branch = row.branch_id;
  if (s.role === 'professional') {
    const pros = (
      await tx.query("SELECT id FROM professionals WHERE tenant_id=$1 AND data->>'account_id'=$2", [
        s.tenant,
        s.actor,
      ])
    ).rows;
    if (!row.plan.steps.some((st: any) => pros.some((p) => p.id === st.professional_id)))
      throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Appointment not found.');
    delete row.customer_phone;
  }
  return row;
}
