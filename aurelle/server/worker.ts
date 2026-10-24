import 'dotenv/config';
import { db, initDB, closeDB, one, transaction, tenantContext } from './db.ts';
import { id, token, event, expireHolds, type Scope } from './domain.ts';
import { executeAI } from './ai.ts';
let running = false;
export async function workerTick() {
  if (running) return;
  running = true;
  try {
    const branches = (await db.query('SELECT tenant_id,id FROM branches')).rows;
    for (const branch of branches) {
      const s: Scope = {
        tenant: branch.tenant_id,
        branch: branch.id,
        actor: '00000000-0000-4000-8000-000000000001',
        role: 'worker',
      };
      const jobs = await transaction(async (tx) => {
        await expireHolds(tx, s);
        await tx.query(
          "UPDATE ai_jobs SET status='unavailable',request=null,result=$3 WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('pending','processing') AND attempts>=2 AND (lease_until IS NULL OR lease_until<now())",
          [
            s.tenant,
            s.branch,
            { message: 'Assistant processing was interrupted. Please submit a fresh request.' },
          ],
        );
        const ai = await one(
          tx,
          "SELECT * FROM ai_jobs WHERE tenant_id=$1 AND branch_id=$2 AND (status='pending' OR status='processing' AND lease_until<now()) AND attempts<2 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
          [s.tenant, s.branch],
        );
        if (ai)
          await tx.query(
            "UPDATE ai_jobs SET status='processing',attempts=attempts+1,lease_until=now()+interval '60 seconds' WHERE tenant_id=$1 AND id=$2",
            [s.tenant, ai.id],
          );
        await tx.query(
          "UPDATE scheduled_jobs SET status='unknown',detail='Provider send was interrupted; reconcile before retrying.' WHERE tenant_id=$1 AND branch_id=$2 AND status='sending' AND lease_until<now()",
          [s.tenant, s.branch],
        );
        const message = await one(
          tx,
          "SELECT * FROM scheduled_jobs WHERE tenant_id=$1 AND branch_id=$2 AND status='pending' AND run_after<=now() ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 1",
          [s.tenant, s.branch],
        );
        if (message)
          await tx.query(
            "UPDATE scheduled_jobs SET status='sending',lease_until=now()+interval '30 seconds' WHERE tenant_id=$1 AND id=$2",
            [s.tenant, message.id],
          );
        await tx.query(
          "UPDATE ai_jobs SET request=null,result=null WHERE tenant_id=$1 AND created_at<now()-interval '24 hours' AND (request IS NOT NULL OR result IS NOT NULL)",
          [s.tenant],
        );
        await tx.query('DELETE FROM sessions WHERE expires_at<now()');
        await tx.query("DELETE FROM otp_challenges WHERE expires_at<now()-interval '1 hour'");
        return { ai, message };
      }, s.tenant);
      if (jobs.ai) {
        const actor = await one(
          db,
          'SELECT role,adult FROM accounts WHERE id=$1 AND tenant_id=$2',
          [jobs.ai.actor_id, s.tenant],
        );
        await tenantContext.run(s.tenant, () =>
          executeAI(
            { ...s, actor: jobs.ai.actor_id, role: actor?.role || 'revoked', adult: actor?.adult },
            jobs.ai.id,
            jobs.ai.kind,
            jobs.ai.request?.text || '',
          ),
        );
      }
      if (jobs.message) await sendMessage(s, jobs.message);
    }
  } finally {
    running = false;
  }
}
async function sendMessage(s: Scope, job: any) {
  let status = 'disabled',
    detail = 'SMS provider is not configured.',
    reference: string | null = null;
  try {
    const b = await transaction(
      (tx) =>
        one(
          tx,
          'SELECT b.*,c.phone FROM bookings b JOIN customers c ON c.tenant_id=b.tenant_id AND c.id=b.customer_id WHERE b.tenant_id=$1 AND b.id=$2',
          [s.tenant, job.booking_id],
        ),
      s.tenant,
    );
    if (!b || b.status !== 'CONFIRMED' || b.pass_version !== job.booking_version) {
      status = 'cancelled';
      detail = 'Obsolete booking revision or cancelled visit.';
    } else if (process.env.SMS_WEBHOOK_URL) {
      const content = `Aurelle ${job.kind === 'confirmation' ? 'appointment confirmed' : 'appointment reminder'}: ${b.reference}, ${new Date(b.starts_at).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })} PKT. Contact the studio for changes.`;
      const response = await fetch(process.env.SMS_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN || ''}`,
          'Idempotency-Key': job.id,
        },
        body: JSON.stringify({ to: b.phone, message: content, request_id: job.id }),
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        status = 'accepted';
        detail = 'Provider accepted the message; final delivery is not verified.';
        reference = response.headers.get('x-message-id');
      } else {
        status = 'unknown';
        detail = 'Provider did not confirm acceptance. Reconcile before retry.';
      }
    }
  } catch {
    status = 'unknown';
    detail = 'Provider acceptance is unknown. Reconcile before retry.';
  }
  await transaction(async (tx) => {
    await tx.query(
      'UPDATE scheduled_jobs SET status=$3,detail=$4,provider_reference=$5,lease_until=null WHERE tenant_id=$1 AND id=$2',
      [s.tenant, job.id, status, detail, reference],
    );
    await event(tx, s, 'message.' + status, job.booking_id);
  }, s.tenant);
}
export function startWorker() {
  const timer = setInterval(
    () => void workerTick().catch(() => console.error('Background work temporarily unavailable.')),
    3000,
  );
  timer.unref();
  return async () => {
    clearInterval(timer);
    while (running) await new Promise((resolve) => setTimeout(resolve, 50));
  };
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/server/worker.ts')) {
  await initDB();
  startWorker();
  const keepAlive = setInterval(() => {}, 60000);
  const end = async () => {
    clearInterval(keepAlive);
    await closeDB();
    process.exit(0);
  };
  process.on('SIGTERM', end);
  process.on('SIGINT', end);
  console.log('Aurelle background worker is ready.');
}
