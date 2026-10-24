export let csrf = '';
export let branchId = sessionStorage.getItem('aurelle_branch') || '';
let actorId = '';
export const setActor = (value: string) => {
  actorId = value;
};
export const setCsrf = (value: string) => {
  csrf = value;
};
export const setBranch = (value: string) => {
  branchId = value;
  sessionStorage.setItem('aurelle_branch', value);
};
export class ApiError extends Error {
  constructor(
    public code: string,
    detail: string,
    public status: number,
  ) {
    super(detail);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
  key?: string,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/v1' + path, {
      ...options,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(branchId ? { 'X-Branch-ID': branchId } : {}),
        ...(options.method && options.method !== 'GET'
          ? { 'Idempotency-Key': key || crypto.randomUUID() }
          : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(
      'NETWORK_ERROR',
      'The connection was interrupted. Refresh to check the current state before repeating a booking or payment.',
      0,
    );
  }
  const result = await res.json();
  if (!res.ok)
    throw new ApiError(
      result.code || 'REQUEST_FAILED',
      result.detail || 'The request could not be completed.',
      res.status,
    );
  return result.data;
}
function operationFor(path: string) {
  if (path === '/booking-holds') return 'booking.hold';
  if (/^\/booking-holds\/[^/]+\/confirm$/.test(path)) return 'booking.confirm';
  if (/^\/bookings\/[^/]+\/cancel$/.test(path)) return 'booking.cancel';
  if (/^\/bookings\/[^/]+\/reschedule$/.test(path)) return 'booking.reschedule';
  if (/^\/bookings\/[^/]+\/checkout$/.test(path)) return 'checkout';
  if (path === '/arrivals/manual') return 'arrival.manual';
  if (path === '/arrivals/scan') return 'arrival.scan';
  if (path.startsWith('/steps/')) return 'step.transition';
  if (path === '/dispatch/call-next') return 'dispatch.next';
  if (path.startsWith('/payments/') && path.endsWith('/refunds')) return 'payment.refund';
  if (path === '/customers') return 'customer.create';
  if (path.startsWith('/customers/')) return 'customer.update';
  if (path === '/services') return 'service.create';
  if (path.startsWith('/services/')) return 'service.publish';
  if (path === '/professionals') return 'professional.create';
  if (path === '/resources') return 'resource.create';
  if (path === '/products') return 'product.create';
  if (path.startsWith('/professionals/')) return 'professional.schedule';
  if (path === '/stock-adjustments') return 'stock.adjust';
  if (path.startsWith('/branches/')) return 'branch.settings';
  if (path === '/cash-sessions') return 'cash.open';
  if (path.startsWith('/cash-sessions/')) return 'cash.close';
  return null;
}
async function mutation<T>(
  path: string,
  method: string,
  data: any,
  version?: number,
  explicitKey?: string,
): Promise<T> {
  const operation = operationFor(path);
  const body = JSON.stringify(data);
  if (!operation)
    return api<T>(
      path,
      { method, body, headers: version !== undefined ? { 'If-Match': String(version) } : {} },
      explicitKey,
    );
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify({ actorId, branchId, path, method, version, body })),
  );
  const fingerprint = Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const storageKey = 'aurelle_pending_' + fingerprint;
  // Only an actor-scoped request hash and random retry key are retained, never contact details or credentials.
  const key = explicitKey || sessionStorage.getItem(storageKey) || crypto.randomUUID();
  sessionStorage.setItem(storageKey, key);
  try {
    const result = await api<T>(
      path,
      { method, body, headers: version !== undefined ? { 'If-Match': String(version) } : {} },
      key,
    );
    sessionStorage.removeItem(storageKey);
    return result;
  } catch (e) {
    if ((e as ApiError).status === 0 || (e as ApiError).status >= 500) {
      try {
        const recovered = await api<T>(`/commands/${key}?operation=${operation}`);
        sessionStorage.removeItem(storageKey);
        return recovered;
      } catch {
        /* Keep the same retry key for the next explicit attempt. */
      }
    } else sessionStorage.removeItem(storageKey);
    throw e;
  }
}
export const post = <T = any>(path: string, data: any = {}, version?: number, key?: string) =>
  mutation<T>(path, 'POST', data, version, key);
export const patch = <T = any>(path: string, data: any, version: number) =>
  mutation<T>(path, 'PATCH', data, version);
export async function currentQuote(quote: any, filters: any) {
  if (new Date(quote.valid_until).getTime() > Date.now() + 2000) return quote;
  const earliest = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(quote.starts_at));
  const options = await post<any[]>('/availability/search', { ...filters, earliest });
  const matching = options.find((p) => p.plan_fingerprint === quote.plan_fingerprint);
  if (!matching)
    throw new ApiError(
      'PLAN_CHANGED',
      'This visit plan changed while you were reviewing it. Refresh the available times and review the new details.',
      409,
    );
  return matching;
}
export const money = (minor: string | number | bigint) =>
  new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Number(minor) / 100);
export const currency = (minor: string | number | bigint) => `PKR ${money(minor)}`;
export const dateNow = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const time = (date: string | Date) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));
export const minutes = (date: string) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(date))
    .split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
};
export const dayLabel = (date: string, long = false) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: long ? 'long' : 'short',
    day: 'numeric',
    month: long ? 'long' : 'short',
    year: long ? 'numeric' : undefined,
  }).format(new Date(`${date}T12:00:00`));
export const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const initials = (name: string) =>
  name
    .split(' ')
    .slice(0, 2)
    .map((s) => s[0])
    .join('');
