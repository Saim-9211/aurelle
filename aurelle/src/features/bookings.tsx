import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock,
  Flower2,
  LoaderCircle,
  Printer,
  Radio,
  RefreshCw,
  ScanLine,
  Scissors,
  Wallet,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  branchId,
  currency,
  currentQuote,
  dateNow,
  dayLabel,
  money,
  post,
  shiftDate,
  time,
} from '../api';
import { Avatar, Badge, ErrorText, Field, Modal } from '../components/ui';
import { useUI } from '../context';
export function BookingModal({
  walkIn = false,
  initialServices = [],
  onClose,
  rescheduling,
}: {
  walkIn?: boolean;
  initialServices?: string[];
  onClose: () => void;
  rescheduling?: any;
}) {
  const { state: s, notify, refresh, date } = useUI();
  const [stage, setStage] = useState(0),
    [selected, setSelected] = useState<string[]>(rescheduling?.plan.service_ids || initialServices),
    [customer, setCustomer] = useState(rescheduling?.customer_id || ''),
    [selectedDate, setSelectedDate] = useState(
      rescheduling ? dateNow() : date < dateNow() ? dateNow() : date,
    ),
    [pro, setPro] = useState(''),
    [earliest, setEarliest] = useState('10:00'),
    [plans, setPlans] = useState<any[]>([]),
    [plan, setPlan] = useState<any>(null),
    [held, setHeld] = useState<any>(null),
    [policy, setPolicy] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [newClient, setNewClient] = useState(false),
    [filter, setFilter] = useState('All');
  const [name, setName] = useState(''),
    [phone, setPhone] = useState('');
  const requestKey = useRef(crypto.randomUUID());
  const total = selected.reduce(
    (n, sid) => n + Number(s.services.find((svc: any) => svc.id === sid)?.price_minor || 0),
    0,
  );
  const duration = selected.reduce(
    (n, sid) => n + Number(s.services.find((svc: any) => svc.id === sid)?.duration || 0),
    0,
  );
  async function searchPlans() {
    setError('');
    setBusy(true);
    try {
      let cid = customer;
      if (newClient) {
        const c = await post('/customers', { name, phone });
        cid = c.id;
        setCustomer(cid);
        setNewClient(false);
        refresh();
      }
      if (!cid) throw new Error('Choose a client or add a new one.');
      if (!selected.length) throw new Error('Choose at least one service.');
      const options = await post('/availability/search', {
        branch_id: branchId,
        service_ids: selected,
        date: selectedDate,
        earliest,
        professional_id: pro || undefined,
        customer_id: cid,
        exclude_booking: rescheduling?.id,
      });
      setPlans(options);
      setPlan(null);
      setStage(1);
      if (!options.length)
        setError(
          'No complete visit fits these filters. Try another date, earlier time, or any professional.',
        );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setError('');
    setBusy(true);
    try {
      if (!policy) throw new Error('Please acknowledge the booking policy.');
      if (!plan) throw new Error('Choose a time to continue.');
      let b = held;
      const fresh = b
        ? plan
        : await currentQuote(plan, {
            branch_id: branchId,
            service_ids: selected,
            date: selectedDate,
            professional_id: pro || undefined,
            customer_id: customer,
            exclude_booking: rescheduling?.id,
          });
      if (rescheduling) {
        await post(
          `/bookings/${rescheduling.id}/reschedule`,
          { quote_id: fresh.quote_id },
          rescheduling.version,
          requestKey.current,
        );
        notify('Appointment rescheduled. A fresh pass is ready.');
        refresh();
        onClose();
        return;
      }
      if (!b) {
        b = await post(
          '/booking-holds',
          {
            quote_id: fresh.quote_id,
            plan_fingerprint: fresh.plan_fingerprint,
            customer_id: customer,
            accepted_policy: policy,
            source: walkIn ? 'walk_in' : 'staff',
          },
          undefined,
          requestKey.current,
        );
        setHeld(b);
      }
      const confirmed = await post(
        `/booking-holds/${b.id}/confirm`,
        {},
        undefined,
        requestKey.current + '-confirm',
      );
      if (walkIn && selectedDate === dateNow())
        await post('/arrivals/manual', { booking_id: confirmed.id, method: 'in_person' });
      setHeld(confirmed);
      setStage(2);
      refresh();
      notify(walkIn ? 'Walk-in appointment confirmed.' : 'A lovely visit is on the books.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        stage === 2
          ? 'A little time, beautifully reserved.'
          : rescheduling
            ? 'A fresh time for the same care.'
            : walkIn
              ? 'Make someone’s day.'
              : 'Make room for a little care.'
      }
      subtitle={
        stage === 2
          ? 'The appointment is confirmed and saved to the studio calendar.'
          : rescheduling
            ? 'The original appointment stays reserved until your new time is confirmed.'
            : walkIn
              ? 'Find real availability and welcome a walk-in to the studio.'
              : 'A thoughtful appointment, from first service to finishing touch.'
      }
      onClose={onClose}
      wide
    >
      {stage < 2 && (
        <div className="wizard-steps">
          <span className={stage === 0 ? 'current' : 'done'}>
            <i>{stage > 0 ? <Check size={12} /> : 1}</i>Client & services
          </span>
          <div />
          <span className={stage === 1 ? 'current' : ''}>
            <i>2</i>Time & confirmation
          </span>
        </div>
      )}
      {stage === 0 ? (
        <>
          <div className="booking-grid">
            <div>
              <div className="section-label">
                01 <span>A LITTLE ABOUT THE VISIT</span>
              </div>
              <Field label="Client">
                <select
                  value={newClient ? 'new' : customer}
                  onChange={(e) => {
                    if (e.target.value === 'new') {
                      setNewClient(true);
                      setCustomer('');
                    } else {
                      setNewClient(false);
                      setCustomer(e.target.value);
                    }
                  }}
                  disabled={!!rescheduling}
                >
                  <option value="">Choose a client</option>
                  <option value="new">+ Add a new client</option>
                  {s.customers.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.phone}
                    </option>
                  ))}
                </select>
              </Field>
              {newClient && (
                <div className="new-client-fields">
                  <Field label="Full name">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Client’s name"
                      required
                    />
                  </Field>
                  <Field label="Mobile number">
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="0300 1234567"
                      type="tel"
                      required
                    />
                  </Field>
                </div>
              )}
              <div className="field-pair">
                <Field label="Appointment date">
                  <input
                    type="date"
                    min={dateNow()}
                    max={shiftDate(dateNow(), 90)}
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />
                </Field>
                <Field label="Start after">
                  <input
                    type="time"
                    min="10:00"
                    max="19:45"
                    value={earliest}
                    onChange={(e) => setEarliest(e.target.value)}
                  />
                </Field>
              </div>
              <Field
                label="Professional preference"
                hint="Any professional matches each service to a qualified team member."
              >
                <select value={pro} onChange={(e) => setPro(e.target.value)}>
                  <option value="">Any qualified professional</option>
                  {s.professionals.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.title}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="booking-summary">
                <Flower2 size={27} strokeWidth={1} />
                <h3>A visit, made just for them.</h3>
                <div>
                  <span>
                    {selected.length} service{selected.length !== 1 ? 's' : ''} · {duration} min
                    incl. reset
                  </span>
                  <strong>{currency(total)}</strong>
                </div>
                <small>Pay at the salon. No online deposit required.</small>
              </div>
            </div>
            <div>
              <div className="section-label">
                02 <span>CHOOSE THEIR LITTLE MOMENTS</span>
              </div>
              <div className="category-tabs">
                {['All', 'Hair', 'Skin', 'Nails', 'Makeup'].map((c) => (
                  <button
                    className={filter === c ? 'selected' : ''}
                    key={c}
                    onClick={() => setFilter(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="service-picker">
                {s.services
                  .filter((svc: any) => svc.active && (filter === 'All' || svc.category === filter))
                  .map((svc: any) => (
                    <button
                      key={svc.id}
                      className={`service-option ${selected.includes(svc.id) ? 'chosen' : ''}`}
                      disabled={!!rescheduling}
                      onClick={() =>
                        setSelected(
                          selected.includes(svc.id)
                            ? selected.filter((x) => x !== svc.id)
                            : selected.length < 6
                              ? [...selected, svc.id]
                              : selected,
                        )
                      }
                    >
                      <span className="checkbox">
                        {selected.includes(svc.id) && <Check size={13} />}
                      </span>
                      <div>
                        <strong>{svc.name}</strong>
                        <small>
                          {svc.duration} min · {svc.category}
                        </small>
                      </div>
                      <strong>
                        {money(svc.price_minor)}
                        <small>PKR</small>
                      </strong>
                    </button>
                  ))}
              </div>
            </div>
          </div>
          <ErrorText error={error} />
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={searchPlans}
              disabled={busy || !selected.length}
            >
              {busy ? <LoaderCircle size={17} className="spin" /> : 'Find a lovely time'}
              <ArrowRight size={17} />
            </button>
          </div>
        </>
      ) : stage === 1 ? (
        <>
          <div className="booking-grid">
            <div>
              <div className="section-label">
                AVAILABLE START TIMES <span>{dayLabel(selectedDate)}</span>
              </div>
              <p className="muted small-text">
                Each time fits the complete visit, with qualified staff and a reserved station.
              </p>
              <div className="slot-grid">
                {plans.map((p) => (
                  <button
                    key={p.quote_id}
                    className={plan?.quote_id === p.quote_id ? 'selected' : ''}
                    onClick={() => setPlan(p)}
                  >
                    <strong>{time(p.starts_at)}</strong>
                    <small>until {time(p.ends_at)}</small>
                  </button>
                ))}
              </div>
              <button className="text-link" onClick={searchPlans} disabled={busy}>
                <RefreshCw size={14} />
                Refresh availability
              </button>
            </div>
            <div className="visit-review">
              <div className="eyebrow">THE LITTLE DETAILS</div>
              <h3>{s.customers.find((c: any) => c.id === customer)?.name || name}</h3>
              <p>{dayLabel(selectedDate, true)}</p>
              {plan ? (
                <div className="plan-timeline">
                  {plan.steps.map((st: any, i: number) => (
                    <div key={i}>
                      <span className="timeline-dot" />
                      <div>
                        <strong>{st.phase}</strong>
                        <small>
                          {time(st.starts_at)}–{time(st.ends_at)} · {st.professional_name}
                        </small>
                        <small>
                          {st.resource_name}
                          {!st.staff ? ' · Professional released' : ''}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">Choose a start time to see your complete visit plan.</p>
              )}
              <div className="review-total">
                <span>Visit total</span>
                <strong>{currency(plan?.total_minor || total)}</strong>
              </div>
              <small className="muted">
                Times include station reset. Quotes are valid for 30 seconds; a confirmed hold
                reserves capacity for 5 minutes.
              </small>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={policy}
                  onChange={(e) => setPolicy(e.target.checked)}
                />
                <span>
                  I’ve reviewed the services and price, and acknowledge the{' '}
                  {s.branch.data.cancellation_hours}-hour cancellation policy.
                </span>
              </label>
            </div>
          </div>
          <ErrorText error={error} />
          <div className="modal-actions">
            <button
              className="btn"
              onClick={() => {
                setStage(0);
                setError('');
                setHeld(null);
                requestKey.current = crypto.randomUUID();
              }}
              disabled={!!held}
            >
              <ArrowLeft size={15} />
              Back
            </button>
            <button className="btn primary" onClick={confirm} disabled={busy || !plan || !policy}>
              {busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{' '}
              {held
                ? 'Finish confirmation'
                : rescheduling
                  ? 'Confirm new time'
                  : 'Confirm appointment'}
            </button>
          </div>
        </>
      ) : (
        <div className="confirmation">
          <div className="success-flower">
            <Check size={30} />
          </div>
          <span className="eyebrow">IT’S ON THE BOOKS</span>
          <h3>{held?.reference}</h3>
          <p>
            {time(held?.starts_at)} on {dayLabel(selectedDate, true)}
          </p>
          <div className="confirmation-details">
            <span>
              {selected
                .map((sid) => s.services.find((svc: any) => svc.id === sid)?.name)
                .join(' + ')}
            </span>
            <strong>{currency(held?.total_minor || total)}</strong>
          </div>
          <p className="muted">
            The visit pass is available in the appointment details. No message has been sent;
            messaging needs a configured provider.
          </p>
          <button className="btn primary" onClick={onClose}>
            Back to a beautiful day <ArrowRight size={17} />
          </button>
        </div>
      )}
    </Modal>
  );
}

export function BookingDetail({
  bookingId,
  initial,
  onClose,
}: {
  bookingId: string;
  initial: any;
  onClose: () => void;
}) {
  const { state: s, notify, refresh, me } = useUI();
  const b = s?.bookings.find((b: any) => b.id === bookingId) || initial;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reason, setReason] = useState(''),
    [cancel, setCancel] = useState(false),
    [rescheduling, setRescheduling] = useState(false),
    [pass, setPass] = useState<any>(null),
    [amount, setAmount] = useState(
      String((Number(b.total_minor) - Number(b.paid_minor || 0)) / 100),
    ),
    [tender, setTender] = useState('cash'),
    [bankRef, setBankRef] = useState(''),
    [delay, setDelay] = useState<any>(null),
    [delayMins, setDelayMins] = useState(10),
    [prepared, setPrepared] = useState(false),
    [verification, setVerification] = useState('in_person');
  const [receiptList, setReceiptList] = useState<any[]>([]);
  const steps =
    s?.steps
      .filter((st: any) => st.booking_id === b.id)
      .sort((a: any, b: any) => a.sequence - b.sequence) || [];
  const canReception = me?.role !== 'professional';
  useEffect(() => {
    api(`/bookings/${b.id}/receipts`)
      .then(setReceiptList)
      .catch(() => {});
  }, [b.id, b.paid_minor]);
  async function run(fn: () => Promise<any>, message: string, close = false) {
    setBusy(true);
    setError('');
    try {
      const result = await fn();
      notify(message);
      refresh();
      if (close) onClose();
      return result;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (rescheduling)
    return (
      <BookingModal
        onClose={() => {
          setRescheduling(false);
          onClose();
        }}
        rescheduling={b}
      />
    );
  return (
    <Modal
      title={b.customer_name}
      subtitle={`${b.reference} · ${dayLabel(new Date(b.starts_at).toISOString().slice(0, 10), true)}`}
      onClose={onClose}
      wide
    >
      <div className="detail-top">
        <div className="flex gap">
          <Avatar name={b.customer_name} color="peach" size="large" />
          <div>
            <strong>
              {time(b.starts_at)} — {time(b.ends_at)}
            </strong>
            <p>
              {b.customer_phone || 'Your assigned client'} ·{' '}
              {b.source === 'walk_in' ? 'Walk-in' : 'Appointment'}
            </p>
          </div>
        </div>
        <Badge status={b.visit_status === 'CHECKOUT' ? 'CHECKOUT' : b.status} />
      </div>
      <div className="detail-grid">
        <div>
          <h4 className="section-label">THE VISIT, STEP BY STEP</h4>
          {steps.map((st: any, i: number) => (
            <div className="step-card" key={st.id}>
              <div className="flex between">
                <span className="step-number">{i + 1}</span>
                <Badge status={st.state} />
              </div>
              <h4>{st.data.phase}</h4>
              <p>
                {st.data.professional_name} · {st.data.resource_name}
              </p>
              <small>
                {time(st.data.starts_at)}–{time(st.data.ends_at)}
                {!st.data.staff ? ' · No active staff required' : ''}
              </small>
              {st.delay_minutes > 0 && <p className="text-rust">Delay: {st.delay_minutes} min</p>}
              <div className="step-actions">
                {st.state === 'READY' && (
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() =>
                      run(() => post(`/steps/${st.id}/call`, {}, st.version), 'Client called.')
                    }
                  >
                    <Radio size={14} />
                    Call client
                  </button>
                )}
                {['READY', 'CALLED'].includes(st.state) && (
                  <button
                    className="btn primary small"
                    disabled={busy || !prepared}
                    onClick={() =>
                      run(
                        () =>
                          post(
                            `/steps/${st.id}/start`,
                            { preparation_confirmed: prepared },
                            st.version,
                          ),
                        'Service started.',
                      )
                    }
                  >
                    <Scissors size={14} />
                    Start {st.data.staff ? 'service' : 'phase'}
                  </button>
                )}
                {st.state === 'ACTIVE' && (
                  <button
                    className="btn primary small"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => post(`/steps/${st.id}/complete`, {}, st.version),
                        'Step complete. The next part of the visit is ready.',
                      )
                    }
                  >
                    <Check size={14} />
                    Complete step
                  </button>
                )}
                {['ACTIVE', 'READY', 'CALLED'].includes(st.state) && (
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() => {
                      setDelay(st);
                      setReason('');
                    }}
                  >
                    <Clock size={14} />
                    Delay
                  </button>
                )}
                {st.state === 'CALLED' && (
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => post(`/steps/${st.id}/mark-absent`, {}, st.version),
                        'Client marked temporarily absent.',
                      )
                    }
                  >
                    Not here
                  </button>
                )}
                {['CALLED', 'TEMPORARILY_ABSENT'].includes(st.state) && (
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => post(`/steps/${st.id}/requeue`, {}, st.version),
                        'Client returned to the ready queue.',
                      )
                    }
                  >
                    Requeue
                  </button>
                )}
              </div>
            </div>
          ))}
          {steps.some((st: any) => ['READY', 'CALLED'].includes(st.state)) && (
            <label className="check-label preparation">
              <input
                type="checkbox"
                checked={prepared}
                onChange={(e) => setPrepared(e.target.checked)}
              />
              <span>
                Preparation is complete, client service consent is verified, and the station is
                ready.
              </span>
            </label>
          )}
        </div>
        <div>
          <div className="detail-summary">
            <div className="eyebrow">THOUGHTFULLY TAKEN CARE OF</div>
            <h3>The little details.</h3>
            {b.plan.service_ids.map((sid: string) => {
              const st = b.plan.steps.find((st: any) => st.service_id === sid);
              return (
                <div className="summary-line" key={sid}>
                  <span>{st?.service_name}</span>
                  <strong>{currency(st?.price_minor || 0)}</strong>
                </div>
              );
            })}
            <div className="summary-line total">
              <strong>Total</strong>
              <strong>{currency(b.total_minor)}</strong>
            </div>
            <div className="summary-line">
              <span>Collected</span>
              <strong>{currency(b.paid_minor || 0)}</strong>
            </div>
            <div className="summary-line">
              <span>Balance</span>
              <strong>{currency(Number(b.total_minor) - Number(b.paid_minor || 0))}</strong>
            </div>
          </div>
          {canReception && b.status === 'CONFIRMED' && !b.arrived_at && (
            <div className="detail-action-box">
              <h4>A warm welcome.</h4>
              <Field label="How was the client verified?">
                <select value={verification} onChange={(e) => setVerification(e.target.value)}>
                  <option value="in_person">In-person verification</option>
                  <option value="phone">Phone verification</option>
                </select>
              </Field>
              <button
                className="btn primary full"
                disabled={busy}
                onClick={() =>
                  run(
                    () => post('/arrivals/manual', { booking_id: b.id, method: verification }),
                    'Client checked in. Their first service is ready.',
                  )
                }
              >
                <CheckCircle2 size={17} />
                Check in client
              </button>
            </div>
          )}
          {canReception && b.visit_status === 'CHECKOUT' && (
            <div className="detail-action-box">
              <h4>Finish on a lovely note.</h4>
              <Field label="Amount to collect (PKR)">
                <input
                  type="number"
                  min="1"
                  max={(Number(b.total_minor) - Number(b.paid_minor || 0)) / 100}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="Payment method">
                <select value={tender} onChange={(e) => setTender(e.target.value)}>
                  <option value="cash">Cash</option>
                  {['owner', 'manager'].includes(me.role) && (
                    <option value="bank_verified">Verified bank transfer</option>
                  )}
                </select>
              </Field>
              {tender === 'bank_verified' && (
                <Field label="Verified bank reference">
                  <input value={bankRef} onChange={(e) => setBankRef(e.target.value)} required />
                </Field>
              )}
              <button
                className="btn primary full"
                disabled={busy}
                onClick={async () => {
                  const result = await run(
                    () =>
                      post(`/bookings/${b.id}/checkout`, {
                        amount_minor: String(Math.round(Number(amount) * 100)),
                        tender,
                        evidence: bankRef,
                      }),
                    'Payment recorded. The receipt is ready.',
                  );
                  if (result) {
                    setReceiptList([...receiptList, { id: result.receipt_id, snapshot: result }]);
                    setAmount('0');
                  }
                }}
              >
                <Wallet size={17} />
                Record payment
              </button>
              <small className="muted">
                Partial payments are supported. The remaining balance stays visible.
              </small>
            </div>
          )}
          {s?.messages?.filter((m: any) => m.booking_id === b.id).length > 0 && (
            <div className="detail-action-box">
              <h4>Client communication</h4>
              {s.messages
                .filter((m: any) => m.booking_id === b.id)
                .map((m: any, i: number) => (
                  <div className="summary-line" key={i}>
                    <div>
                      <strong>{m.kind.replaceAll('_', ' ')}</strong>
                      <small
                        className="muted"
                        style={{ display: 'block', fontSize: 10, marginTop: 5 }}
                      >
                        {m.detail || 'Scheduled for ' + time(m.run_after)}
                      </small>
                    </div>
                    <span className="tag">{m.status}</span>
                  </div>
                ))}
            </div>
          )}
          {receiptList.map((r: any) => (
            <Link className="receipt-link" key={r.id} to={`/receipt/${r.id}`} target="_blank">
              <Printer size={17} />
              <div>
                <strong>View & print receipt</strong>
                <small>
                  {currency(r.snapshot.paid_minor)} · {r.snapshot.tender}
                </small>
              </div>
              <ArrowUpRight size={17} />
            </Link>
          ))}
          {['CONFIRMED', 'FULFILLED'].includes(b.status) && canReception && (
            <button
              className="btn full"
              onClick={async () => {
                try {
                  setPass(await api(`/bookings/${b.id}/pass`));
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              <ScanLine size={17} />
              View visit pass
            </button>
          )}
          {canReception && b.status === 'CONFIRMED' && !b.arrived_at && (
            <div className="flex gap detail-edit-actions">
              <button className="text-link" onClick={() => setRescheduling(true)}>
                Reschedule
              </button>
              <button
                className="text-link text-rust"
                onClick={() => {
                  setCancel(!cancel);
                  setReason('');
                }}
              >
                Cancel appointment
              </button>
            </div>
          )}
          {cancel && (
            <div className="detail-action-box">
              <Field label="Cancellation reason">
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
              </Field>
              <button
                className="btn danger full"
                disabled={busy || reason.length < 3}
                onClick={() =>
                  run(
                    () => post(`/bookings/${b.id}/cancel`, { reason }, b.version),
                    'Appointment cancelled and capacity released.',
                    true,
                  )
                }
              >
                Confirm cancellation
              </button>
            </div>
          )}
        </div>
      </div>
      {delay && (
        <div className="inline-panel">
          <h4>Keep the studio in the loop.</h4>
          <div className="field-pair">
            <Field label="Delay (minutes)">
              <input
                type="number"
                min="5"
                max="120"
                value={delayMins}
                onChange={(e) => setDelayMins(Number(e.target.value))}
              />
            </Field>
            <Field label="Reason">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="A little extra finishing time…"
              />
            </Field>
          </div>
          <div className="flex gap">
            <button className="btn small" onClick={() => setDelay(null)}>
              Dismiss
            </button>
            <button
              className="btn primary small"
              disabled={busy || !reason}
              onClick={async () => {
                const result = await run(
                  () =>
                    post(`/steps/${delay.id}/delay`, { minutes: delayMins, reason }, delay.version),
                  'Delay recorded. Reception can review the downstream appointments.',
                );
                if (result) setDelay(null);
              }}
            >
              Record delay
            </button>
          </div>
        </div>
      )}
      {pass && (
        <div className="visit-pass">
          <img src={pass.qr} alt={`QR visit pass for ${b.reference}`} />
          <div>
            <span className="eyebrow">YOUR LITTLE INVITATION</span>
            <h3>{pass.reference}</h3>
            <p>Show this pass at reception. It contains no client contact details.</p>
            <button
              className="text-link"
              onClick={() =>
                navigator.clipboard
                  .writeText(pass.payload)
                  .then(() => notify('Pass content copied.'))
                  .catch(() => setError('Clipboard access was unavailable.'))
              }
            >
              Copy pass for scanner
            </button>
          </div>
        </div>
      )}
      <ErrorText error={error} />
      <div className="modal-actions">
        <small className="muted">Version {b.version} · All actions are recorded.</small>
        <button className="btn" onClick={onClose}>
          Close details
        </button>
      </div>
    </Modal>
  );
}
