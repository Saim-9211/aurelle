import {
  Activity,
  ArrowRight,
  Check,
  ChevronRight,
  CreditCard,
  Flower2,
  Phone,
  Send,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { currency, patch, post, time } from '../api';
import { Empty, ErrorText, Field, PageHeading } from '../components/ui';
import { useUI } from '../context';
export function SettingsPage({ config }: { config: any }) {
  const { state: s, notify, refresh } = useUI();
  const [tab, setTab] = useState('Studio'),
    [form, setForm] = useState({ ...s.branch.data, name: s.branch.name }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [cashAmount, setCashAmount] = useState('5000'),
    [cashResult, setCashResult] = useState<any>(null);
  useEffect(() => {
    setForm({ ...s.branch.data, name: s.branch.name });
  }, [s.branch.id, s.branch.version]);
  return (
    <>
      <PageHeading
        eyebrow="YOUR STUDIO, YOUR WAY"
        title="Make the little details yours."
        description="A considered foundation for how your business runs, every day."
      />
      <div className="settings-layout">
        <div className="settings-tabs">
          {[
            { name: 'Studio', icon: Flower2 },
            { name: 'Policies', icon: ShieldCheck },
            { name: 'Connections', icon: Sparkles },
            { name: 'Cash register', icon: Wallet },
            { name: 'Activity', icon: Activity },
          ].map((t) => (
            <button
              key={t.name}
              className={tab === t.name ? 'selected' : ''}
              onClick={() => {
                setTab(t.name);
                setError('');
              }}
            >
              <t.icon size={18} />
              {t.name}
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
        <section className="card settings-content">
          {tab === 'Studio' || tab === 'Policies' ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  await patch(
                    `/branches/${s.branch.id}`,
                    {
                      name: form.name,
                      address: form.address,
                      phone: form.phone,
                      open: form.open,
                      close: form.close,
                      cancellation_hours: Number(form.cancellation_hours),
                    },
                    s.branch.version,
                  );
                  notify('Your studio settings are saved.');
                  refresh();
                } catch (e: any) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="settings-title">
                <h2>
                  {tab === 'Studio'
                    ? 'A place for beautiful things.'
                    : 'Clear expectations. Thoughtful care.'}
                </h2>
                <p>
                  {tab === 'Studio'
                    ? 'The details clients see, and the hours your team plans around.'
                    : 'Policies are versioned. Confirmed appointments retain the terms they were booked under.'}
                </p>
              </div>
              {tab === 'Studio' ? (
                <>
                  <Field label="Studio name">
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Address">
                    <textarea
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      rows={2}
                      required
                    />
                  </Field>
                  <Field label="Contact number">
                    <input
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      required
                    />
                  </Field>
                  <div className="field-pair">
                    <Field label="Opening time">
                      <input
                        type="time"
                        value={form.open}
                        onChange={(e) => setForm({ ...form, open: e.target.value })}
                        required
                      />
                    </Field>
                    <Field label="Closing time">
                      <input
                        type="time"
                        value={form.close}
                        onChange={(e) => setForm({ ...form, close: e.target.value })}
                        required
                      />
                    </Field>
                  </div>
                  <div className="settings-fixed">
                    <span>
                      Currency <strong>PKR · Pakistani Rupee</strong>
                    </span>
                    <span>
                      Timezone <strong>Asia/Karachi · UTC+05:00</strong>
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <Field
                    label="Customer cancellation notice (hours)"
                    hint="Inside this window, clients contact reception so staff can review the visit."
                  >
                    <input
                      type="number"
                      min="0"
                      max="168"
                      value={form.cancellation_hours}
                      onChange={(e) =>
                        setForm({ ...form, cancellation_hours: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <div className="notice">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>Pay at the salon</strong>
                      <p>
                        No deposit or cancellation charge is configured. Online payments remain
                        disabled until a contracted provider is connected and verified.
                      </p>
                    </div>
                  </div>
                  <div className="settings-fixed">
                    <span>
                      Appointment hold <strong>5 minutes</strong>
                    </span>
                    <span>
                      Quote validity <strong>30 seconds</strong>
                    </span>
                    <span>
                      Tax configuration <strong>No tax configured</strong>
                    </span>
                  </div>
                </>
              )}
              <ErrorText error={error} />
              <div className="modal-actions">
                <span className="muted small-text">Policy version {s.branch.version}</span>
                <button type="submit" className="btn primary" disabled={busy}>
                  <Check size={16} />
                  Save changes
                </button>
              </div>
            </form>
          ) : tab === 'Connections' ? (
            <>
              <div className="settings-title">
                <h2>A little more connected.</h2>
                <p>Provider credentials stay on the server. Their live status is shown below.</p>
              </div>
              {[
                {
                  name: 'Gemini assistant',
                  description: 'Adult workforce booking drafts and owner summaries.',
                  configured: config?.ai_configured,
                  icon: Sparkles,
                },
                {
                  name: 'SMS verification',
                  description: 'Phone verification through the configured SMS adapter.',
                  configured: config?.sms_configured,
                  icon: Phone,
                },
                {
                  name: 'Online payments',
                  description: 'Gateway onboarding and settlement verification required.',
                  configured: false,
                  icon: CreditCard,
                },
                {
                  name: 'WhatsApp',
                  description: 'Approved templates and explicit channel consent required.',
                  configured: false,
                  icon: Send,
                },
              ].map((c) => (
                <div className="connection-row" key={c.name}>
                  <span className="product-glyph">
                    <c.icon size={21} />
                  </span>
                  <div>
                    <strong>{c.name}</strong>
                    <p>{c.description}</p>
                  </div>
                  <span className={`tag ${c.configured ? 'sage' : 'sand'}`}>
                    {c.configured ? 'Configured' : 'Not connected'}
                  </span>
                </div>
              ))}
              <div className="form-note">
                <ShieldCheck size={18} />
                Set provider secrets in the server environment. Never enter them into browser
                storage.
              </div>
            </>
          ) : tab === 'Cash register' ? (
            <>
              <div className="settings-title">
                <h2>A thoughtful close to the day.</h2>
                <p>Record your float, count the drawer, and keep discrepancies visible.</p>
              </div>
              <div className="notice">
                <Wallet size={22} />
                <div>
                  <strong>
                    {s.cash_session ? 'Your register is open.' : 'Your register is closed.'}
                  </strong>
                  <p>
                    {s.cash_session
                      ? `Opening float: ${currency(s.cash_session.opening_minor)} · Opened ${time(s.cash_session.opened_at)}`
                      : 'Start a cash session before collecting your daily receipts.'}
                  </p>
                </div>
              </div>
              <Field
                label={s.cash_session ? 'Counted cash in drawer (PKR)' : 'Opening float (PKR)'}
              >
                <input
                  type="number"
                  min="0"
                  value={cashAmount}
                  onChange={(e) => setCashAmount(e.target.value)}
                />
              </Field>
              <button
                className="btn primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = s.cash_session
                      ? await post(`/cash-sessions/${s.cash_session.id}/close`, {
                          counted_minor: String(Math.round(Number(cashAmount) * 100)),
                        })
                      : await post('/cash-sessions', {
                          opening_minor: String(Math.round(Number(cashAmount) * 100)),
                        });
                    setCashResult(s.cash_session ? result : null);
                    notify(s.cash_session ? 'Cash session closed.' : 'Your cash session is open.');
                    refresh();
                  } catch (e: any) {
                    notify(e.message, 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {s.cash_session ? 'Close & reconcile register' : 'Open register'}
                <ArrowRight size={16} />
              </button>
              {cashResult && (
                <div className="inline-panel">
                  <h4>Cash close recorded.</h4>
                  <p>Expected: {currency(cashResult.expected_minor)}</p>
                  <p>Counted: {currency(cashResult.counted_minor)}</p>
                  <p>Discrepancy: {currency(cashResult.discrepancy_minor)}</p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="settings-title">
                <h2>Every little action, accounted for.</h2>
                <p>Recent immutable operational activity for this branch.</p>
              </div>
              {s.audit.length ? (
                s.audit.map((a: any, i: number) => (
                  <div className="audit-row" key={i}>
                    <span className="product-glyph">
                      <Activity size={17} />
                    </span>
                    <div>
                      <strong>{a.action.replaceAll('.', ' ').replaceAll('_', ' ')}</strong>
                      <small>Reference {a.target_id?.slice(0, 8)}</small>
                    </div>
                    <time>{time(a.created_at)}</time>
                  </div>
                ))
              ) : (
                <Empty
                  title="A clean page"
                  description="New bookings, payments, and changes will appear here as they happen."
                />
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
