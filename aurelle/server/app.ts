import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { verify as verifyPassword } from 'argon2';
import { authenticator } from 'otplib';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  db,
  transaction,
  one,
  tenantContext,
  TENANT,
  BRANCH,
  SECOND_BRANCH,
  type SQL,
} from './db.ts';
import {
  id,
  token,
  hash,
  phone,
  Problem,
  localDate,
  event,
  command,
  expireHolds,
  findPlans,
  checkVersion,
  bookingFor,
  requireRole,
  type Scope,
} from './domain.ts';
import {
  createQuote,
  createHold,
  confirmHold,
  arrive,
  transitionStep,
  checkout,
  reschedule,
} from './operations.ts';
import { submitAI } from './ai.ts';
import { decryptFactor } from './security.ts';
import { DEMO_OWNER, DEMO_RECEPTION, DEMO_PRO, DEMO_CUSTOMER } from './seed.ts';
declare global {
  namespace Express {
    interface Request {
      scope: Scope;
      account: any;
      session: any;
    }
  }
}
const demo = () => process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE !== 'false';
const secret = process.env.SESSION_SECRET || token();
const digest = (value: string) => createHmac('sha256', secret).update(value).digest('hex');
const staff = ['owner', 'manager', 'receptionist'];
const allStaff = [...staff, 'professional'];
const uuid = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const json = (res: Response, data: any, status = 200) =>
  res
    .status(status)
    .json({ data, meta: { request_id: id(), server_time: new Date().toISOString() } });
const route =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
function scope(req: Request) {
  if (!req.scope) throw new Problem(401, 'SESSION_EXPIRED', 'Sign in to continue.');
  return req.scope;
}
function roles(req: Request, allowed: string[]) {
  const s = scope(req);
  requireRole(s, allowed);
  return s;
}
async function issueSession(res: Response, account: any, elevated = false) {
  if (res.req.cookies?.aurelle_session)
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [
      digest(res.req.cookies.aurelle_session),
    ]);
  const raw = token(),
    csrf = token();
  const expiry = new Date(
    Date.now() + (account.role === 'customer' ? 30 * 86400000 : 12 * 3600000),
  );
  await db.query(
    'INSERT INTO sessions(token_hash,account_id,csrf,expires_at,elevated) VALUES($1,$2,$3,$4,$5)',
    [digest(raw), account.id, csrf, expiry, elevated],
  );
  res.cookie('aurelle_session', raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiry,
  });
  return csrf;
}
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('json replacer', (key: string, value: any) =>
    typeof value === 'bigint' ||
    (key.endsWith('_minor') && value !== null && value !== undefined && typeof value !== 'object')
      ? String(value)
      : value,
  );
  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === 'production'
          ? {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:'],
                connectSrc: ["'self'"],
                fontSrc: ["'self'"],
              },
            }
          : false,
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use(
    '/api',
    rateLimit({ windowMs: 60000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.use(
    '/api/v1/auth',
    rateLimit({ windowMs: 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.use('/api', async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const raw = req.cookies.aurelle_session;
      if (!raw) {
        next();
        return;
      }
      const session = await one(
        db,
        'SELECT s.*,a.tenant_id,a.branch_id,a.role,a.name,a.email,a.customer_id,a.adult FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now()',
        [digest(raw)],
      );
      if (!session) {
        next();
        return;
      }
      if (
        session.role !== 'customer' &&
        Date.now() - new Date(session.last_seen).getTime() > 30 * 60000
      ) {
        next();
        return;
      }
      req.session = session;
      req.account = session;
      req.scope = {
        tenant: session.tenant_id,
        branch: session.branch_id,
        actor: session.account_id,
        role: session.role,
        customer: session.customer_id,
        adult: session.adult,
      };
      if (req.headers['x-branch-id'] && session.role !== 'customer') {
        const bid = uuid.parse(req.headers['x-branch-id']);
        const branch = await one(db, 'SELECT id FROM branches WHERE tenant_id=$1 AND id=$2', [
          session.tenant_id,
          bid,
        ]);
        if (!branch || (session.role !== 'owner' && bid !== session.branch_id))
          throw new Problem(403, 'BRANCH_ACCESS_DENIED', 'You do not have access to this branch.');
        req.scope.branch = bid;
      }
      await db.query('UPDATE sessions SET last_seen=now() WHERE token_hash=$1', [
        session.token_hash,
      ]);
      tenantContext.run(req.scope.tenant, () => next());
    } catch (e) {
      next(e);
    }
  });
  const api = express.Router();
  api.use((req, res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.scope &&
      !req.path.startsWith('/auth/')
    ) {
      const expected = process.env.APP_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
      const origin = req.headers.origin;
      if (
        origin &&
        origin !== expected &&
        !(demo() && origin === expected.replace('localhost', '127.0.0.1'))
      )
        return next(
          new Problem(403, 'ORIGIN_DENIED', 'This request came from an untrusted origin.'),
        );
      if (req.headers['x-csrf-token'] !== req.session.csrf)
        return next(new Problem(403, 'CSRF_REQUIRED', 'Refresh the page to restore your session.'));
    }
    next();
  });
  api.get('/health/live', (_req, res) => json(res, { status: 'ok' }));
  api.get(
    '/health/ready',
    route(async (_req, res) => {
      await db.query('SELECT 1');
      json(res, { status: 'ready', mode: demo() ? 'development' : 'production' });
    }),
  );
  api.get('/config', (_req, res) =>
    json(res, {
      demo: demo(),
      ai_configured: !!process.env.GEMINI_API_KEY,
      sms_configured: !!process.env.SMS_WEBHOOK_URL,
      currency: 'PKR',
      timezone: 'Asia/Karachi',
    }),
  );
  api.post(
    '/auth/demo',
    route(async (req, res) => {
      if (!demo()) throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Not found.');
      const role = z
        .enum(['owner', 'receptionist', 'professional', 'customer'])
        .parse(req.body.role || 'owner');
      const account = await one(db, 'SELECT * FROM accounts WHERE id=$1', [
        {
          owner: DEMO_OWNER,
          receptionist: DEMO_RECEPTION,
          professional: DEMO_PRO,
          customer: DEMO_CUSTOMER,
        }[role],
      ]);
      const csrf = await issueSession(res, account, true);
      json(res, { csrf });
    }),
  );
  api.post(
    '/auth/workforce/login',
    route(async (req, res) => {
      const input = z
        .object({
          email: z.email(),
          password: z.string().min(1).max(200),
          totp: z.string().optional(),
        })
        .parse(req.body);
      const a = await one(
        db,
        "SELECT * FROM accounts WHERE lower(email)=lower($1) AND role<>'customer'",
        [input.email],
      );
      if (!a?.password_hash || !(await verifyPassword(a.password_hash, input.password)))
        throw new Problem(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
      if (
        a.mfa_secret &&
        (!input.totp ||
          !authenticator.verify({ token: input.totp, secret: decryptFactor(a.mfa_secret) }))
      )
        throw new Problem(401, 'MFA_REQUIRED', 'Enter the code from your authenticator.');
      if (
        process.env.NODE_ENV === 'production' &&
        ['owner', 'manager'].includes(a.role) &&
        !a.mfa_secret
      )
        throw new Problem(
          403,
          'MFA_ENROLLMENT_REQUIRED',
          'An administrator must provision MFA before this account can sign in.',
        );
      const csrf = await issueSession(res, a, !!a.mfa_secret);
      json(res, { csrf });
    }),
  );
  api.post(
    '/auth/logout',
    route(async (req, res) => {
      if (req.session)
        await db.query('DELETE FROM sessions WHERE token_hash=$1', [req.session.token_hash]);
      res.clearCookie('aurelle_session');
      json(res, { signed_out: true });
    }),
  );
  api.get(
    '/me',
    route(async (req, res) => {
      const s = scope(req);
      const branches = (
        await db.query("SELECT * FROM branches WHERE tenant_id=$1 AND ($2='owner' OR id=$3)", [
          s.tenant,
          s.role,
          s.branch,
        ])
      ).rows;
      json(res, {
        id: s.actor,
        name: req.account.name,
        role: s.role,
        customer_id: s.customer,
        csrf: req.session.csrf,
        branches,
        demo: demo(),
      });
    }),
  );
  api.post(
    '/auth/otp/challenges',
    route(async (req, res) => {
      const number = phone(z.string().parse(req.body.phone));
      const recent = await one(
        db,
        "SELECT id FROM otp_challenges WHERE phone_hash=$1 AND expires_at>now()-interval '5 minutes' ORDER BY expires_at DESC LIMIT 1",
        [digest(number)],
      );
      if (recent)
        throw new Problem(
          429,
          'OTP_COOLDOWN',
          'Please wait a few minutes before requesting another code.',
        );
      if (!demo() && !process.env.SMS_WEBHOOK_URL)
        throw new Problem(
          503,
          'SMS_NOT_CONFIGURED',
          'Phone verification is temporarily unavailable. Please call the salon.',
        );
      const challenge = id(),
        code = String(randomInt(100000, 1000000));
      await db.query(
        'INSERT INTO otp_challenges(id,phone_hash,phone,code_hash,expires_at) VALUES($1,$2,$3,$4,$5)',
        [
          challenge,
          digest(number),
          number,
          digest(challenge + code),
          new Date(Date.now() + 300000),
        ],
      );
      if (process.env.SMS_WEBHOOK_URL) {
        const sent = await fetch(process.env.SMS_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN || ''}`,
          },
          body: JSON.stringify({
            to: number,
            message: `Your Aurelle verification code is ${code}. Valid for 5 minutes.`,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!sent.ok)
          throw new Problem(
            503,
            'PROVIDER_UNAVAILABLE',
            'The verification message could not be sent. Please contact reception.',
          );
      }
      json(
        res,
        { challenge_id: challenge, ...(demo() ? { demo_code: code } : {}), expires_in: 300 },
        201,
      );
    }),
  );
  api.post(
    '/auth/otp/verify',
    route(async (req, res) => {
      const input = z
        .object({
          challenge_id: uuid,
          code: z.string().regex(/^\d{6}$/),
          name: z.string().min(2).max(100),
          branch_id: uuid,
        })
        .parse(req.body);
      const result = await transaction(async (tx) => {
        const ch = await one(tx, 'SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE', [
          input.challenge_id,
        ]);
        if (!ch || ch.consumed || ch.attempts >= 5 || new Date(ch.expires_at) < new Date())
          return { error: 'This verification code expired. Request a new one.' };
        await tx.query('UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1', [ch.id]);
        if (!timingSafeEqual(Buffer.from(ch.code_hash), Buffer.from(digest(ch.id + input.code))))
          return { error: 'The verification code is incorrect.' };
        const branch = await one(tx, 'SELECT * FROM branches WHERE id=$1', [input.branch_id]);
        if (!branch) throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Branch not found.');
        await tx.query('UPDATE otp_challenges SET consumed=true WHERE id=$1', [ch.id]);
        let customer = await one(tx, 'SELECT * FROM customers WHERE tenant_id=$1 AND phone=$2', [
          branch.tenant_id,
          ch.phone,
        ]);
        if (!customer) {
          const cid = id();
          await tx.query(
            'INSERT INTO customers(tenant_id,branch_id,id,name,phone,data) VALUES($1,$2,$3,$4,$5,$6)',
            [
              branch.tenant_id,
              branch.id,
              cid,
              input.name,
              ch.phone,
              { consents: { service: true } },
            ],
          );
          customer = await one(tx, 'SELECT * FROM customers WHERE tenant_id=$1 AND id=$2', [
            branch.tenant_id,
            cid,
          ]);
        }
        let account = await one(
          tx,
          "SELECT * FROM accounts WHERE tenant_id=$1 AND customer_id=$2 AND role='customer'",
          [branch.tenant_id, customer.id],
        );
        if (!account) {
          const aid = id();
          await tx.query(
            "INSERT INTO accounts(id,tenant_id,branch_id,name,role,customer_id) VALUES($1,$2,$3,$4,'customer',$5)",
            [aid, branch.tenant_id, branch.id, customer.name, customer.id],
          );
          account = await one(tx, 'SELECT * FROM accounts WHERE id=$1', [aid]);
        }
        return { account };
      });
      if (result.error) throw new Problem(401, 'INVALID_OTP', result.error);
      const csrf = await issueSession(res, result.account);
      json(res, { csrf });
    }),
  );
  api.get(
    '/public/branches',
    route(async (_req, res) =>
      json(res, (await db.query('SELECT id,name,data FROM branches ORDER BY name')).rows),
    ),
  );
  api.get(
    '/public/branches/:id/services',
    route(async (req, res) =>
      json(
        res,
        (
          await db.query(
            'SELECT id,name,category,price_minor::text,duration,data FROM services WHERE branch_id=$1 AND active=true ORDER BY category,name',
            [uuid.parse(req.params.id)],
          )
        ).rows,
      ),
    ),
  );
  api.get(
    '/public/branches/:id/professionals',
    route(async (req, res) =>
      json(
        res,
        (
          await db.query(
            "SELECT id,name,title,jsonb_build_object('skills',data->'skills','color',data->'color','initials',data->'initials') AS data FROM professionals WHERE branch_id=$1 AND active=true ORDER BY name",
            [uuid.parse(req.params.id)],
          )
        ).rows,
      ),
    ),
  );
  api.post(
    '/availability/search',
    route(async (req, res) => {
      const input = z
        .object({
          branch_id: uuid,
          service_ids: z.array(uuid).min(1).max(6),
          date: dateSchema,
          earliest: z
            .string()
            .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
            .optional(),
          professional_id: uuid.optional(),
          customer_id: uuid.optional(),
          exclude_booking: uuid.optional(),
          budget_minor: z.string().regex(/^\d+$/).optional(),
        })
        .parse(req.body);
      const branch = await one(db, 'SELECT * FROM branches WHERE id=$1', [input.branch_id]);
      if (!branch) throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Branch not found.');
      const s: Scope = req.scope
        ? { ...req.scope, branch: input.branch_id }
        : {
            tenant: branch.tenant_id,
            branch: input.branch_id,
            actor: '00000000-0000-4000-8000-000000000000',
            role: 'public',
          };
      if (
        s.tenant !== branch.tenant_id ||
        (req.scope &&
          req.scope.role !== 'customer' &&
          req.scope.role !== 'owner' &&
          input.branch_id !== req.scope.branch)
      )
        throw new Problem(403, 'BRANCH_ACCESS_DENIED', 'Branch access denied.');
      if (input.exclude_booking) {
        await bookingFor(db, s, input.exclude_booking);
      }
      if (s.role === 'customer') input.customer_id = s.customer;
      json(
        res,
        await transaction(async (tx) => {
          await expireHolds(tx, s);
          const plans = await findPlans(tx, s, input);
          const quotes = [];
          for (const p of plans) quotes.push(await createQuote(tx, s, p, input.customer_id));
          return quotes;
        }, s.tenant),
      );
    }),
  );
  api.get(
    '/state',
    route(async (req, res) => {
      const s = roles(req, allStaff);
      const date = dateSchema.parse(req.query.date || localDate());
      const result = await transaction(async (tx) => {
        await expireHolds(tx, s);
        const branch = await one(tx, 'SELECT * FROM branches WHERE tenant_id=$1 AND id=$2', [
          s.tenant,
          s.branch,
        ]);
        const bookings = (
          await tx.query(
            "SELECT b.*,c.name AS customer_name,c.phone AS customer_phone,COALESCE((SELECT SUM(p.amount_minor) FROM payments p JOIN invoices i ON i.tenant_id=p.tenant_id AND i.id=p.invoice_id WHERE i.tenant_id=b.tenant_id AND i.booking_id=b.id),0)::text AS paid_minor FROM bookings b JOIN customers c ON c.tenant_id=b.tenant_id AND c.id=b.customer_id WHERE b.tenant_id=$1 AND b.branch_id=$2 AND (b.starts_at AT TIME ZONE 'Asia/Karachi')::date=$3::date ORDER BY b.starts_at",
            [s.tenant, s.branch, date],
          )
        ).rows;
        const steps = (
          await tx.query(
            "SELECT s.* FROM steps s JOIN bookings b ON b.tenant_id=s.tenant_id AND b.id=s.booking_id WHERE s.tenant_id=$1 AND s.branch_id=$2 AND (b.starts_at AT TIME ZONE 'Asia/Karachi')::date=$3::date AND s.state<>'CANCELLED' ORDER BY s.sequence",
            [s.tenant, s.branch, date],
          )
        ).rows;
        const customers = (
          await tx.query(
            'SELECT * FROM customers WHERE tenant_id=$1 AND branch_id=$2 ORDER BY name',
            [s.tenant, s.branch],
          )
        ).rows;
        const services = (
          await tx.query(
            'SELECT *,price_minor::text FROM services WHERE tenant_id=$1 AND branch_id=$2 ORDER BY category,name',
            [s.tenant, s.branch],
          )
        ).rows;
        const professionals = (
          await tx.query(
            'SELECT * FROM professionals WHERE tenant_id=$1 AND branch_id=$2 ORDER BY name',
            [s.tenant, s.branch],
          )
        ).rows;
        const products = (
          await tx.query(
            'SELECT * FROM products WHERE tenant_id=$1 AND branch_id=$2 ORDER BY name',
            [s.tenant, s.branch],
          )
        ).rows;
        const audit = (
          await tx.query(
            'SELECT action,target_id,created_at FROM audit_events WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 12',
            [s.tenant, s.branch],
          )
        ).rows;
        const history = (
          await tx.query(
            "SELECT (p.created_at AT TIME ZONE 'Asia/Karachi')::date::text AS date,SUM(p.amount_minor)::text AS amount FROM payments p WHERE p.tenant_id=$1 AND p.branch_id=$2 AND (p.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $3::date-6 AND $3::date GROUP BY 1 ORDER BY 1",
            [s.tenant, s.branch, date],
          )
        ).rows;
        const refundTotal = await one(
          tx,
          "SELECT COALESCE(SUM(amount_minor),0)::text AS amount FROM refunds WHERE tenant_id=$1 AND branch_id=$2 AND (created_at AT TIME ZONE 'Asia/Karachi')::date=$3::date",
          [s.tenant, s.branch, date],
        );
        const cash = await one(
          tx,
          'SELECT * FROM cash_sessions WHERE tenant_id=$1 AND branch_id=$2 AND closed_at IS NULL',
          [s.tenant, s.branch],
        );
        const messages = (
          await tx.query(
            'SELECT booking_id,kind,status,detail,run_after FROM scheduled_jobs WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 50',
            [s.tenant, s.branch],
          )
        ).rows;
        const resources = (
          await tx.query(
            "SELECT id,name,resource_type FROM assets WHERE tenant_id=$1 AND branch_id=$2 AND kind='resource' ORDER BY name",
            [s.tenant, s.branch],
          )
        ).rows;
        const payload: any = {
          resources,
          messages,
          branch,
          bookings: bookings.map(({ pass_token: _, pass_hash: __, ...b }) => b),
          steps,
          customers,
          services,
          professionals,
          products,
          audit,
          history,
          refund_minor: refundTotal!.amount,
          cash_session: cash || null,
          date,
        };
        if (s.role === 'professional') {
          const assigned = professionals
            .filter((p) => p.data.account_id === s.actor)
            .map((p) => p.id);
          payload.steps = steps.filter((st) => assigned.includes(st.data.professional_id));
          const bids = new Set(payload.steps.map((st: any) => st.booking_id));
          payload.bookings = payload.bookings.filter((b: any) => bids.has(b.id));
          payload.customers = customers
            .filter((c) => payload.bookings.some((b: any) => b.customer_id === c.id))
            .map(({ phone: _, data: __, ...c }) => c);
          payload.history = [];
          payload.audit = [];
          payload.messages = [];
          payload.products = [];
          payload.cash_session = null;
          payload.bookings = payload.bookings.map(({ customer_phone: _, ...b }: any) => b);
        }
        return payload;
      }, s.tenant);
      json(res, result);
    }),
  );
  api.get(
    '/bookings',
    route(async (req, res) => {
      const s = scope(req);
      const rows = (
        await db.query(
          "SELECT b.id FROM bookings b WHERE b.tenant_id=$1 AND ($2<>'customer' OR b.customer_id=$3) AND ($2='customer' OR b.branch_id=$4) AND ($2<>'professional' OR EXISTS(SELECT 1 FROM steps st JOIN professionals p ON p.tenant_id=st.tenant_id AND p.id=(st.data->>'professional_id')::uuid WHERE st.tenant_id=b.tenant_id AND st.booking_id=b.id AND p.data->>'account_id'=$5)) ORDER BY b.starts_at DESC LIMIT 100",
          [s.tenant, s.role, s.customer || null, s.branch, s.actor],
        )
      ).rows;
      const results = [];
      for (const row of rows) {
        const b = await bookingFor(
          db,
          {
            ...s,
            branch:
              s.role === 'customer'
                ? (await one(db, 'SELECT branch_id FROM bookings WHERE tenant_id=$1 AND id=$2', [
                    s.tenant,
                    row.id,
                  ]))!.branch_id
                : s.branch,
          },
          row.id,
        );
        delete b.pass_hash;
        delete b.pass_token;
        results.push(b);
      }
      json(res, results);
    }),
  );
  api.get(
    '/bookings/:id/pass',
    route(async (req, res) => {
      const s = scope(req);
      const b = await bookingFor(db, s, uuid.parse(req.params.id));
      if (!['CONFIRMED', 'FULFILLED'].includes(b.status))
        throw new Problem(409, 'PASS_REVOKED', 'This pass is no longer valid.');
      const payload = `aurelle:v1:${b.id}:${b.pass_version}:${b.pass_token}`;
      json(res, {
        reference: b.reference,
        payload,
        qr: await QRCode.toDataURL(payload, {
          width: 280,
          margin: 2,
          color: { dark: '#333c34', light: '#ffffff' },
        }),
      });
    }),
  );
  const mutate = (
    allowed: string[],
    name: string,
    handler: (tx: SQL, s: Scope, req: Request) => Promise<any>,
  ) =>
    route(async (req, res) => {
      const s = roles(req, allowed);
      const result = await transaction(
        (tx) =>
          command(
            tx,
            s,
            name,
            String(req.headers['idempotency-key'] || ''),
            { body: req.body, params: req.params, version: req.headers['if-match'] },
            () => handler(tx, s, req),
          ),
        s.tenant,
      );
      json(res, result, 201);
    });
  api.post(
    '/booking-holds',
    mutate([...staff, 'customer'], 'booking.hold', async (tx, s, req) =>
      createHold(
        tx,
        s,
        z
          .object({
            quote_id: uuid,
            plan_fingerprint: z.string(),
            customer_id: uuid.optional(),
            accepted_policy: z.boolean(),
            source: z.enum(['staff', 'customer', 'walk_in']).optional(),
          })
          .parse(req.body),
      ),
    ),
  );
  api.post(
    '/booking-holds/:id/confirm',
    mutate([...staff, 'customer'], 'booking.confirm', (tx, s, req) =>
      confirmHold(tx, s, uuid.parse(req.params.id)),
    ),
  );
  api.delete(
    '/booking-holds/:id',
    mutate([...staff, 'customer'], 'booking.release', async (tx, s, req) => {
      const b = await bookingFor(tx, s, uuid.parse(req.params.id));
      if (b.status !== 'HELD')
        throw new Problem(409, 'NOT_HELD', 'Only provisional appointments can be released.');
      await tx.query(
        "UPDATE bookings SET status='CANCELLED',pass_hash=null,version=version+1 WHERE tenant_id=$1 AND id=$2",
        [s.tenant, b.id],
      );
      await tx.query('UPDATE reservations SET active=false WHERE tenant_id=$1 AND booking_id=$2', [
        s.tenant,
        b.id,
      ]);
      await event(tx, s, 'booking.released', b.id);
      return { released: true };
    }),
  );
  api.post(
    '/bookings/:id/cancel',
    mutate([...staff, 'customer'], 'booking.cancel', async (tx, s, req) => {
      const b = await bookingFor(tx, s, uuid.parse(req.params.id));
      checkVersion(b, String(req.headers['if-match'] || ''));
      const reason = z.string().min(3).max(500).parse(req.body.reason);
      const started = await one(
        tx,
        'SELECT id FROM steps WHERE tenant_id=$1 AND booking_id=$2 AND actual_start IS NOT NULL LIMIT 1',
        [s.tenant, b.id],
      );
      if (started)
        throw new Problem(
          409,
          'WORK_ALREADY_STARTED',
          'This visit has started. A manager must preserve delivered work and arrange a partial service disposition.',
        );
      if (b.status !== 'CONFIRMED' || b.visit_status === 'IN_SERVICE' || b.status === 'FULFILLED')
        throw new Problem(
          409,
          'CANNOT_CANCEL',
          'This appointment cannot be cancelled. Preserve completed work and contact a manager.',
        );
      if (
        s.role === 'customer' &&
        new Date(b.starts_at).getTime() - Date.now() <
          Number(b.policy.cancellation_hours || 12) * 3600000
      )
        throw new Problem(
          409,
          'CANCELLATION_WINDOW',
          'Please call the salon to change an appointment inside the cancellation window.',
        );
      await tx.query(
        "UPDATE bookings SET status='CANCELLED',visit_status=null,pass_hash=null,pass_token=null,pass_version=pass_version+1,version=version+1 WHERE tenant_id=$1 AND id=$2",
        [s.tenant, b.id],
      );
      await tx.query('UPDATE reservations SET active=false WHERE tenant_id=$1 AND booking_id=$2', [
        s.tenant,
        b.id,
      ]);
      await tx.query(
        "UPDATE steps SET state='CANCELLED',version=version+1 WHERE tenant_id=$1 AND booking_id=$2 AND state<>'COMPLETED'",
        [s.tenant, b.id],
      );
      await event(tx, s, 'booking.cancelled', b.id, { reason });
      return { cancelled: true };
    }),
  );
  api.post(
    '/bookings/:id/reschedule',
    mutate([...staff, 'customer'], 'booking.reschedule', (tx, s, req) =>
      reschedule(tx, s, uuid.parse(req.params.id), req.body, String(req.headers['if-match'] || '')),
    ),
  );
  api.post(
    '/arrivals/manual',
    mutate(staff, 'arrival.manual', (tx, s, req) =>
      arrive(tx, s, uuid.parse(req.body.booking_id), req.body.method),
    ),
  );
  api.post(
    '/arrivals/scan',
    mutate(staff, 'arrival.scan', async (tx, s, req) => {
      const payload = z.string().max(200).parse(req.body.payload);
      const match = /^aurelle:v1:([a-f\d-]{36}):(\d+):([a-f\d]{64})$/.exec(payload);
      if (!match) throw new Problem(422, 'INVALID_PASS', 'This is not a valid Aurelle visit pass.');
      const b = await bookingFor(tx, s, match[1]);
      if (b.pass_version !== Number(match[2]) || b.pass_hash !== hash(match[3]))
        throw new Problem(
          409,
          'PASS_REVOKED',
          'This pass was revoked. Ask the client for their current pass.',
        );
      return arrive(tx, s, b.id, 'pass');
    }),
  );
  api.post(
    '/steps/:id/:action',
    mutate(allStaff, 'step.transition', (tx, s, req) =>
      transitionStep(
        tx,
        s,
        uuid.parse(req.params.id),
        String(req.params.action),
        String(req.headers['if-match'] || ''),
        req.body,
      ),
    ),
  );
  api.post(
    '/dispatch/call-next',
    mutate(allStaff, 'dispatch.next', async (tx, s) => {
      const rows = (
        await tx.query(
          "SELECT st.* FROM steps st JOIN bookings b ON b.tenant_id=st.tenant_id AND b.id=st.booking_id WHERE st.tenant_id=$1 AND st.branch_id=$2 AND st.state='READY' AND b.arrived_at IS NOT NULL ORDER BY (st.data->>'starts_at')::timestamptz,b.arrived_at LIMIT 100",
          [s.tenant, s.branch],
        )
      ).rows;
      const assigned = (
        await tx.query(
          "SELECT id FROM professionals WHERE tenant_id=$1 AND data->>'account_id'=$2",
          [s.tenant, s.actor],
        )
      ).rows.map((p) => p.id);
      const occupied = (
        await tx.query('SELECT asset_id FROM occupancies WHERE tenant_id=$1 AND ended_at IS NULL', [
          s.tenant,
        ])
      ).rows.map((o) => o.asset_id);
      const st = rows.find(
        (st) =>
          (s.role !== 'professional' || assigned.includes(st.data.professional_id)) &&
          new Date(st.data.starts_at).getTime() <= Date.now() + 300000 &&
          ![st.data.resource_id, ...(st.data.staff ? [st.data.professional_id] : [])].some((a) =>
            occupied.includes(a),
          ),
      );
      if (!st) throw new Problem(409, 'NO_READY_CLIENT', 'There are no eligible clients to call.');
      return transitionStep(tx, s, st.id, 'call', String(st.version), {});
    }),
  );
  api.post(
    '/bookings/:id/checkout',
    mutate(staff, 'checkout', (tx, s, req) =>
      checkout(
        tx,
        s,
        uuid.parse(req.params.id),
        z
          .object({
            amount_minor: z.string().regex(/^\d+$/).optional(),
            tender: z.enum(['cash', 'bank_verified']),
            evidence: z.string().max(200).optional(),
          })
          .parse(req.body),
      ),
    ),
  );
  api.get(
    '/receipts/:id',
    route(async (req, res) => {
      const s = scope(req);
      const row = await one(
        db,
        'SELECT r.*,b.customer_id,b.branch_id FROM receipts r JOIN invoices i ON i.tenant_id=r.tenant_id AND i.id=r.invoice_id JOIN bookings b ON b.tenant_id=i.tenant_id AND b.id=i.booking_id WHERE r.tenant_id=$1 AND r.id=$2',
        [s.tenant, uuid.parse(req.params.id)],
      );
      if (
        !row ||
        (s.role === 'customer' && row.customer_id !== s.customer) ||
        (s.role !== 'customer' && row.branch_id !== s.branch)
      )
        throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Receipt not found.');
      json(res, row);
    }),
  );
  api.get(
    '/bookings/:id/receipts',
    route(async (req, res) => {
      const s = scope(req);
      const b = await bookingFor(db, s, uuid.parse(req.params.id));
      json(
        res,
        (
          await db.query(
            'SELECT r.id,r.snapshot,r.created_at FROM receipts r JOIN invoices i ON i.tenant_id=r.tenant_id AND i.id=r.invoice_id WHERE i.tenant_id=$1 AND i.booking_id=$2 ORDER BY r.created_at',
            [s.tenant, b.id],
          )
        ).rows,
      );
    }),
  );
  api.post(
    '/payments/:id/refunds',
    mutate(['owner', 'manager'], 'payment.refund', async (tx, s, req) => {
      if (!req.session.elevated)
        throw new Problem(
          401,
          'MFA_REQUIRED',
          'An elevated session is required to issue a refund.',
        );
      const input = z
        .object({ amount_minor: z.string().regex(/^\d+$/), reason: z.string().min(5).max(300) })
        .parse(req.body);
      const p = await one(
        tx,
        'SELECT * FROM payments WHERE tenant_id=$1 AND branch_id=$2 AND id=$3',
        [s.tenant, s.branch, uuid.parse(req.params.id)],
      );
      if (!p) throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Payment not found.');
      if (p.tender !== 'cash')
        throw new Problem(
          409,
          'REFUND_REVIEW_REQUIRED',
          'Verified bank refunds require an external settlement review.',
        );
      const refunded = await one(
        tx,
        'SELECT COALESCE(SUM(amount_minor),0)::text AS amount FROM refunds WHERE tenant_id=$1 AND payment_id=$2',
        [s.tenant, p.id],
      );
      const amount = BigInt(input.amount_minor);
      if (amount <= 0n || amount > BigInt(p.amount_minor) - BigInt(refunded!.amount))
        throw new Problem(422, 'INVALID_AMOUNT', 'Refund exceeds the remaining refundable amount.');
      const rid = id();
      await tx.query(
        'INSERT INTO refunds(tenant_id,branch_id,id,payment_id,amount_minor,reason) VALUES($1,$2,$3,$4,$5,$6)',
        [s.tenant, s.branch, rid, p.id, amount.toString(), input.reason],
      );
      for (const [account, value] of [
        ['cash', -amount],
        ['service_revenue', amount],
      ] as const)
        await tx.query(
          'INSERT INTO ledger_entries(tenant_id,id,transaction_id,account,amount_minor) VALUES($1,$2,$3,$4,$5)',
          [s.tenant, id(), rid, account, value.toString()],
        );
      await event(tx, s, 'refund.issued', rid, {
        amount_minor: amount.toString(),
        reason: input.reason,
      });
      return { id: rid, amount_minor: amount.toString() };
    }),
  );
  api.post(
    '/customers',
    mutate(staff, 'customer.create', async (tx, s, req) => {
      const input = z
        .object({
          name: z.string().min(2).max(100),
          phone: z.string(),
          email: z.union([z.email(), z.literal('')]).optional(),
          marketing: z.boolean().optional(),
        })
        .parse(req.body);
      const number = phone(input.phone);
      const existing = await one(tx, 'SELECT * FROM customers WHERE tenant_id=$1 AND phone=$2', [
        s.tenant,
        number,
      ]);
      if (existing) return existing;
      const cid = id();
      await tx.query(
        'INSERT INTO customers(tenant_id,branch_id,id,name,phone,data) VALUES($1,$2,$3,$4,$5,$6)',
        [
          s.tenant,
          s.branch,
          cid,
          input.name,
          number,
          {
            email: input.email || '',
            marketing: input.marketing || false,
            consents: { service: true, marketing: input.marketing || false },
          },
        ],
      );
      await tx.query(
        "INSERT INTO assets(tenant_id,branch_id,id,kind,name) VALUES($1,$2,$3,'recipient','Recipient')",
        [s.tenant, s.branch, cid],
      );
      await event(tx, s, 'customer.created', cid);
      return one(tx, 'SELECT * FROM customers WHERE tenant_id=$1 AND id=$2', [s.tenant, cid]);
    }),
  );
  api.patch(
    '/customers/:id',
    mutate(staff, 'customer.update', async (tx, s, req) => {
      const c = await one(tx, 'SELECT * FROM customers WHERE tenant_id=$1 AND id=$2', [
        s.tenant,
        uuid.parse(req.params.id),
      ]);
      if (!c) throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Client not found.');
      checkVersion(c, String(req.headers['if-match'] || ''));
      const input = z
        .object({
          name: z.string().min(2).max(100),
          preferences: z.string().max(1000),
          marketing: z.boolean(),
        })
        .parse(req.body);
      await tx.query(
        'UPDATE customers SET name=$3,data=$4,version=version+1 WHERE tenant_id=$1 AND id=$2',
        [
          s.tenant,
          c.id,
          input.name,
          { ...c.data, preferences: input.preferences, marketing: input.marketing },
        ],
      );
      await event(tx, s, 'customer.updated', c.id);
      return { updated: true };
    }),
  );
  api.post(
    '/services',
    mutate(['owner', 'manager'], 'service.create', async (tx, s, req) => {
      const input = z
        .object({
          name: z.string().min(2).max(100),
          category: z.enum(['Hair', 'Skin', 'Nails', 'Makeup']),
          price_minor: z.string().regex(/^\d{1,9}$/),
          duration: z.number().int().min(10).max(480),
          description: z.string().max(500),
        })
        .parse(req.body);
      const sid = id(),
        resource = { Hair: 'chair', Skin: 'room', Nails: 'nail', Makeup: 'room' }[input.category];
      const data = {
        description: input.description,
        resource,
        phases: [
          { name: input.name, minutes: input.duration - 5, staff: true, resource },
          { name: 'Station reset', minutes: 5, staff: false, resource },
        ],
      };
      await tx.query(
        'INSERT INTO services(tenant_id,branch_id,id,name,category,price_minor,duration,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          s.tenant,
          s.branch,
          sid,
          input.name,
          input.category,
          input.price_minor,
          input.duration,
          data,
        ],
      );
      await event(tx, s, 'service.published', sid);
      return { id: sid };
    }),
  );
  api.patch(
    '/services/:id',
    mutate(['owner', 'manager'], 'service.publish', async (tx, s, req) => {
      const svc = await one(
        tx,
        'SELECT * FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id=$3',
        [s.tenant, s.branch, uuid.parse(req.params.id)],
      );
      if (!svc) throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Service not found.');
      checkVersion(svc, String(req.headers['if-match'] || ''));
      const input = z
        .object({
          name: z.string().min(2).max(100),
          price_minor: z.string().regex(/^\d{1,9}$/),
          duration: z.number().int().min(10).max(480),
          active: z.boolean(),
        })
        .parse(req.body);
      const phases =
        svc.data.phases.length === 2
          ? [
              { ...svc.data.phases[0], name: input.name, minutes: input.duration - 5 },
              svc.data.phases[1],
            ]
          : svc.data.phases;
      if (svc.data.phases.length > 2 && input.duration !== svc.duration)
        throw new Problem(
          422,
          'PHASE_EDIT_REQUIRED',
          'Multi-phase durations must be updated through a phase-aware migration.',
        );
      await tx.query(
        'UPDATE services SET name=$3,price_minor=$4,duration=$5,active=$6,data=$7,version=version+1 WHERE tenant_id=$1 AND id=$2',
        [
          s.tenant,
          svc.id,
          input.name,
          input.price_minor,
          input.duration,
          input.active,
          { ...svc.data, phases },
        ],
      );
      await event(tx, s, 'service.published', svc.id);
      return { updated: true };
    }),
  );
  api.patch(
    '/professionals/:id',
    mutate(['owner', 'manager'], 'professional.schedule', async (tx, s, req) => {
      const p = await one(
        tx,
        'SELECT * FROM professionals WHERE tenant_id=$1 AND branch_id=$2 AND id=$3',
        [s.tenant, s.branch, uuid.parse(req.params.id)],
      );
      if (!p) throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Professional not found.');
      checkVersion(p, String(req.headers['if-match'] || ''));
      const input = z
        .object({
          start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
          end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
          off_days: z.array(z.number().int().min(0).max(6)),
          acknowledged_impacts: z.boolean(),
        })
        .parse(req.body);
      if (input.start >= input.end)
        throw new Problem(422, 'INVALID_SHIFT', 'The shift must end after it starts.');
      const impact = (
        await tx.query(
          "SELECT DISTINCT b.id,b.reference FROM bookings b JOIN reservations r ON r.tenant_id=b.tenant_id AND r.booking_id=b.id WHERE b.tenant_id=$1 AND r.asset_id=$2 AND b.status='CONFIRMED' AND b.ends_at>now() AND r.active",
          [s.tenant, p.id],
        )
      ).rows;
      if (impact.length && !input.acknowledged_impacts)
        throw new Problem(
          409,
          'SCHEDULE_IMPACTS',
          `${impact.length} future appointments may be affected. Review the impact list and acknowledge before saving.`,
        );
      await tx.query(
        'UPDATE professionals SET data=$3,version=version+1 WHERE tenant_id=$1 AND id=$2',
        [
          s.tenant,
          p.id,
          { ...p.data, start: input.start, end: input.end, off_days: input.off_days },
        ],
      );
      await event(tx, s, 'schedule.changed', p.id, { impacted: impact.map((b) => b.reference) });
      return { impacted: impact };
    }),
  );
  api.post(
    '/professionals',
    mutate(['owner', 'manager'], 'professional.create', async (tx, s, req) => {
      const input = z
        .object({
          name: z.string().min(2).max(100),
          title: z.string().min(2).max(100),
          skills: z
            .array(z.enum(['Hair', 'Skin', 'Nails', 'Makeup']))
            .min(1)
            .max(4),
          start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
          end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
        })
        .parse(req.body);
      if (input.start >= input.end)
        throw new Problem(422, 'INVALID_SHIFT', 'Shift must end after it starts.');
      const pid = id(),
        data = {
          skills: input.skills,
          start: input.start,
          end: input.end,
          breaks: [],
          off_days: [],
          color: 'sage',
        };
      await tx.query(
        'INSERT INTO professionals(tenant_id,branch_id,id,name,title,data) VALUES($1,$2,$3,$4,$5,$6)',
        [s.tenant, s.branch, pid, input.name, input.title, data],
      );
      await tx.query(
        "INSERT INTO assets(tenant_id,branch_id,id,kind,name) VALUES($1,$2,$3,'professional',$4)",
        [s.tenant, s.branch, pid, input.name],
      );
      await event(tx, s, 'professional.created', pid);
      return { id: pid };
    }),
  );
  api.post(
    '/resources',
    mutate(['owner', 'manager'], 'resource.create', async (tx, s, req) => {
      const input = z
        .object({
          name: z.string().min(2).max(100),
          resource_type: z.enum(['chair', 'room', 'nail']),
        })
        .parse(req.body);
      const rid = id();
      await tx.query(
        "INSERT INTO assets(tenant_id,branch_id,id,kind,name,resource_type) VALUES($1,$2,$3,'resource',$4,$5)",
        [s.tenant, s.branch, rid, input.name, input.resource_type],
      );
      await event(tx, s, 'resource.created', rid);
      return { id: rid };
    }),
  );
  api.post(
    '/products',
    mutate(['owner', 'manager'], 'product.create', async (tx, s, req) => {
      const input = z
        .object({
          name: z.string().min(2).max(100),
          category: z.string().min(2).max(50),
          unit: z.string().min(1).max(30),
          on_hand: z.number().int().min(0).max(100000),
          reorder_at: z.number().int().min(0).max(100000),
          price_minor: z.string().regex(/^\d{1,10}$/),
        })
        .parse(req.body);
      const pid = id();
      await tx.query(
        'INSERT INTO products(tenant_id,branch_id,id,name,category,unit,on_hand,reorder_at,price_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          s.tenant,
          s.branch,
          pid,
          input.name,
          input.category,
          input.unit,
          input.on_hand,
          input.reorder_at,
          input.price_minor,
        ],
      );
      if (input.on_hand)
        await tx.query(
          'INSERT INTO stock_movements(tenant_id,id,product_id,delta,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6)',
          [s.tenant, id(), pid, input.on_hand, 'Opening stock', s.actor],
        );
      await event(tx, s, 'product.created', pid);
      return { id: pid };
    }),
  );
  api.post(
    '/stock-adjustments',
    mutate(staff, 'stock.adjust', async (tx, s, req) => {
      const input = z
        .object({
          product_id: uuid,
          delta: z
            .number()
            .int()
            .min(-10000)
            .max(10000)
            .refine((n) => n !== 0),
          reason: z.string().min(3).max(200),
        })
        .parse(req.body);
      const p = await one(
        tx,
        'SELECT * FROM products WHERE tenant_id=$1 AND branch_id=$2 AND id=$3',
        [s.tenant, s.branch, input.product_id],
      );
      if (!p) throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Product not found.');
      checkVersion(p, String(req.headers['if-match'] || ''));
      if (p.on_hand + input.delta < 0)
        throw new Problem(409, 'INSUFFICIENT_STOCK', 'This adjustment would make stock negative.');
      await tx.query(
        'UPDATE products SET on_hand=on_hand+$3,version=version+1 WHERE tenant_id=$1 AND id=$2',
        [s.tenant, p.id, input.delta],
      );
      await tx.query(
        'INSERT INTO stock_movements(tenant_id,id,product_id,delta,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6)',
        [s.tenant, id(), p.id, input.delta, input.reason, s.actor],
      );
      await event(tx, s, 'stock.adjusted', p.id, { delta: input.delta });
      return { on_hand: p.on_hand + input.delta };
    }),
  );
  api.patch(
    '/branches/:id',
    mutate(['owner'], 'branch.settings', async (tx, s, req) => {
      const b = await one(tx, 'SELECT * FROM branches WHERE tenant_id=$1 AND id=$2', [
        s.tenant,
        uuid.parse(req.params.id),
      ]);
      if (!b) throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Branch not found.');
      checkVersion(b, String(req.headers['if-match'] || ''));
      const input = z
        .object({
          name: z.string().min(2).max(100),
          address: z.string().min(5).max(300),
          phone: z.string().max(30),
          open: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
          close: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
          cancellation_hours: z.number().int().min(0).max(168),
        })
        .parse(req.body);
      if (input.open >= input.close)
        throw new Problem(422, 'INVALID_HOURS', 'Closing time must be after opening time.');
      await tx.query(
        'UPDATE branches SET name=$3,data=$4,version=version+1 WHERE tenant_id=$1 AND id=$2',
        [s.tenant, b.id, input.name, { ...b.data, ...input }],
      );
      await event(tx, s, 'branch.updated', b.id);
      return { updated: true };
    }),
  );
  api.post(
    '/cash-sessions',
    mutate(staff, 'cash.open', async (tx, s, req) => {
      const opening = z.string().regex(/^\d+$/).parse(req.body.opening_minor);
      const cid = id();
      await tx.query(
        'INSERT INTO cash_sessions(tenant_id,branch_id,id,opening_minor,actor_id) VALUES($1,$2,$3,$4,$5)',
        [s.tenant, s.branch, cid, opening, s.actor],
      );
      await event(tx, s, 'cash.opened', cid);
      return { id: cid };
    }),
  );
  api.post(
    '/cash-sessions/:id/close',
    mutate(['owner', 'manager'], 'cash.close', async (tx, s, req) => {
      const c = await one(
        tx,
        'SELECT * FROM cash_sessions WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND closed_at IS NULL',
        [s.tenant, s.branch, uuid.parse(req.params.id)],
      );
      if (!c) throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Open cash session not found.');
      const counted = z.string().regex(/^\d+$/).parse(req.body.counted_minor);
      const receipts = await one(
        tx,
        "SELECT COALESCE(SUM(amount_minor),0)::text AS amount FROM payments WHERE tenant_id=$1 AND branch_id=$2 AND tender='cash' AND created_at>=$3",
        [s.tenant, s.branch, c.opened_at],
      );
      const refunds = await one(
        tx,
        'SELECT COALESCE(SUM(amount_minor),0)::text AS amount FROM refunds WHERE tenant_id=$1 AND branch_id=$2 AND created_at>=$3',
        [s.tenant, s.branch, c.opened_at],
      );
      const expected = BigInt(c.opening_minor) + BigInt(receipts!.amount) - BigInt(refunds!.amount);
      await tx.query(
        'UPDATE cash_sessions SET closed_at=now(),counted_minor=$3,expected_minor=$4 WHERE tenant_id=$1 AND id=$2',
        [s.tenant, c.id, counted, expected.toString()],
      );
      await event(tx, s, 'cash.closed', c.id, {
        discrepancy_minor: (BigInt(counted) - expected).toString(),
      });
      return {
        expected_minor: expected.toString(),
        counted_minor: counted,
        discrepancy_minor: (BigInt(counted) - expected).toString(),
      };
    }),
  );
  api.post(
    '/ai/booking-drafts',
    route(async (req, res) => {
      const s = roles(req, staff);
      const text = z.string().min(5).max(2000).parse(req.body.text);
      json(res, await submitAI(s, 'booking', text), 202);
    }),
  );
  api.post(
    '/ai/operations-briefs',
    route(async (req, res) => {
      const s = roles(req, ['owner', 'manager']);
      json(res, await submitAI(s, 'brief', ''), 202);
    }),
  );
  api.get(
    '/ai/jobs/:id',
    route(async (req, res) => {
      const s = scope(req);
      const job = await one(
        db,
        "SELECT id,status,result,model FROM ai_jobs WHERE tenant_id=$1 AND actor_id=$2 AND id=$3 AND created_at>now()-interval '24 hours'",
        [s.tenant, s.actor, uuid.parse(req.params.id)],
      );
      if (!job) throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Assistant request not found.');
      json(res, job);
    }),
  );
  api.get(
    '/commands/:key',
    route(async (req, res) => {
      const s = scope(req);
      const result = await one(
        db,
        'SELECT result FROM command_results WHERE tenant_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4',
        [s.tenant, s.actor, String(req.query.operation), String(req.params.key)],
      );
      if (!result) throw new Problem(404, 'RESOURCE_NOT_FOUND', 'No completed command was found.');
      json(res, result.result);
    }),
  );
  api.get(
    '/events',
    route(async (req, res) => {
      const s = roles(req, allStaff);
      if (req.query.branch_id) {
        const branch = uuid.parse(req.query.branch_id);
        if (s.role !== 'owner' && branch !== s.branch)
          throw new Problem(403, 'BRANCH_ACCESS_DENIED', 'Branch access denied.');
        if (
          !(await one(db, 'SELECT id FROM branches WHERE tenant_id=$1 AND id=$2', [
            s.tenant,
            branch,
          ]))
        )
          throw new Problem(404, 'RESOURCE_NOT_FOUND', 'Branch not found.');
        s.branch = branch;
      }
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      let cursor = Number(req.headers['last-event-id'] || 0);
      let busy = false;
      const tick = async () => {
        if (busy) return;
        busy = true;
        try {
          const current = await one(
            db,
            "SELECT token_hash FROM sessions se JOIN accounts a ON a.id=se.account_id WHERE token_hash=$1 AND expires_at>now() AND se.last_seen>now()-interval '30 minutes' AND a.role=$2 AND a.tenant_id=$3 AND (a.role='owner' OR a.branch_id=$4)",
            [req.session.token_hash, s.role, s.tenant, s.branch],
          );
          if (!current) {
            res.end();
            return;
          }
          const rows = (
            await db.query(
              'SELECT sequence,type FROM outbox_events WHERE tenant_id=$1 AND branch_id=$2 AND sequence>$3 ORDER BY sequence LIMIT 100',
              [s.tenant, s.branch, cursor],
            )
          ).rows;
          for (const row of rows) {
            cursor = Number(row.sequence);
            res.write(
              `id: ${cursor}\nevent: invalidate\ndata: ${JSON.stringify({ type: row.type })}\n\n`,
            );
          }
          res.write(': heartbeat\n\n');
        } catch {
          res.end();
        } finally {
          busy = false;
        }
      };
      const timer = setInterval(() => void tick(), 5000);
      req.on('close', () => clearInterval(timer));
      await tick();
    }),
  );
  api.get(
    '/display/snapshot',
    route(async (req, res) => {
      const s = roles(req, allStaff);
      const rows = (
        await db.query(
          "SELECT b.reference,st.state,st.data->>'resource_name' AS station FROM steps st JOIN bookings b ON b.tenant_id=st.tenant_id AND b.id=st.booking_id WHERE st.tenant_id=$1 AND st.branch_id=$2 AND st.state IN ('CALLED','ACTIVE') ORDER BY st.called_until DESC NULLS LAST LIMIT 20",
          [s.tenant, s.branch],
        )
      ).rows;
      json(
        res,
        rows.map((r) => ({ token: r.reference.slice(-4), state: r.state, station: r.station })),
      );
    }),
  );
  api.use((_req, _res, next) =>
    next(new Problem(404, 'RESOURCE_NOT_FOUND', 'This endpoint does not exist.')),
  );
  app.use('/api/v1', api);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const invalid = err instanceof z.ZodError;
    const overlap = ['23P01', '23505'].includes(err.code);
    const status = err instanceof Problem ? err.status : invalid ? 422 : overlap ? 409 : 500;
    if (status === 500) console.error('Request failed:', err.message);
    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: `urn:aurelle:problem:${err.code || 'invalid-input'}`,
        title: status === 500 ? 'Something went wrong' : 'Request could not be completed',
        status,
        code:
          err instanceof Problem
            ? err.code
            : invalid
              ? 'INVALID_INPUT'
              : overlap
                ? 'SLOT_UNAVAILABLE'
                : 'INTERNAL_ERROR',
        detail:
          err instanceof Problem
            ? err.message
            : invalid
              ? err.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ')
              : overlap
                ? 'The selected capacity is no longer available. Refresh and choose another time.'
                : 'The request could not be completed. Try again.',
        request_id: id(),
        retryable: status >= 500,
      });
  });
  return app;
}
