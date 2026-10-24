import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  Clock,
  Download,
  Flower2,
  Globe,
  Heart,
  Leaf,
  LoaderCircle,
  MapPin,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  ScanLine,
  Scissors,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  api,
  currency,
  currentQuote,
  dateNow,
  dayLabel,
  money,
  post,
  setCsrf,
  shiftDate,
  time,
} from '../api';
import { Badge, Empty, ErrorText, Field, Modal, PageHeading } from '../components/ui';
import { useUI } from '../context';
export function Login({ demo, onDemo }: { demo: boolean; onDemo: () => void }) {
  const { notify } = useUI();
  const client = useQueryClient();
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [totp, setTotp] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <div className="login-story">
        <Link to="/book" className="brand">
          <Flower2 size={35} strokeWidth={1} />
          <span>
            aurelle<sup>®</sup>
          </span>
        </Link>
        <div className="login-editorial">
          <div className="eyebrow">FOR THE ART OF EVERYDAY CARE</div>
          <h1>
            A beautiful studio.
            <br />A little more <em>flow.</em>
          </h1>
          <p>
            More time for your craft. More care for your clients. A thoughtful home for everything
            in between.
          </p>
          <div className="login-botanical">
            <Flower2 size={230} strokeWidth={0.4} />
            <Leaf size={145} strokeWidth={0.5} />
          </div>
        </div>
        <small>SALON, BEAUTIFULLY MANAGED.</small>
      </div>
      <div className="login-form">
        <span className="eyebrow">YOUR STUDIO IS WAITING</span>
        <h2>A warm welcome back.</h2>
        <p>Sign in to make room for a beautiful day.</p>
        {demo && (
          <div className="demo-entry">
            <span className="tag sage">SAMPLE WORKSPACE</span>
            <p>
              Take a thoughtful look around with synthetic salon data. Bookings and changes persist
              locally.
            </p>
            <button className="btn primary full" onClick={onDemo}>
              Explore the studio
              <ArrowRight size={17} />
            </button>
            <div className="or-divider">or sign in to your account</div>
          </div>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await post('/auth/workforce/login', { email, password, totp: totp || undefined });
              client.invalidateQueries({ queryKey: ['me'] });
              notify('Welcome back to your studio.');
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Work email">
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@yourstudio.com"
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Your password"
            />
          </Field>
          <Field label="Authenticator code (if enabled)">
            <input
              inputMode="numeric"
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              maxLength={6}
              placeholder="6-digit code"
              autoComplete="one-time-code"
            />
          </Field>
          <ErrorText error={error} />
          <button className="btn primary full" disabled={busy} type="submit">
            {busy ? <LoaderCircle size={17} className="spin" /> : 'Sign in to your studio'}
            <ArrowRight size={17} />
          </button>
        </form>
        <Link className="text-link" to="/book">
          Looking for a little care? Book a visit <ArrowUpRight size={15} />
        </Link>
        <small className="login-note">
          <ShieldCheck size={14} />
          Your workspace uses secure, server-managed sessions.
        </small>
      </div>
    </div>
  );
}

export function CustomerPortal({ config }: { config: any }) {
  const { me, notify } = useUI();
  const queryClient = useQueryClient(),
    location = useLocation();
  const [locale, setLocale] = useState('en'),
    [branch, setBranchLocal] = useState(''),
    [services, setServices] = useState<string[]>([]),
    [date, setDate] = useState(shiftDate(dateNow(), 1)),
    [earliest, setEarliest] = useState('10:00'),
    [pro, setPro] = useState(''),
    [stage, setStage] = useState(0),
    [plans, setPlans] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [name, setName] = useState(''),
    [phoneValue, setPhoneValue] = useState(''),
    [challenge, setChallenge] = useState<any>(null),
    [code, setCode] = useState(''),
    [policy, setPolicy] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmed, setConfirmed] = useState<any>(null),
    [tab, setTab] = useState(location.pathname.includes('appointments') ? 'visits' : 'book'),
    [category, setCategory] = useState('All'),
    [pass, setPass] = useState<any>(null),
    [cancel, setCancel] = useState<any>(null),
    [cancelReason, setCancelReason] = useState(''),
    [signInOnly, setSignInOnly] = useState(false);
  const branches = useQuery({
    queryKey: ['public-branches'],
    queryFn: () => api('/public/branches'),
  });
  useEffect(() => {
    if (branches.data && !branch)
      setBranchLocal(
        branches.data.find((b: any) => b.name === 'Gulberg Studio')?.id || branches.data[0]?.id,
      );
  }, [branches.data]);
  const catalogue = useQuery({
    queryKey: ['catalogue', branch],
    queryFn: () => api(`/public/branches/${branch}/services`),
    enabled: !!branch,
  });
  const professionals = useQuery({
    queryKey: ['public-pros', branch],
    queryFn: () => api(`/public/branches/${branch}/professionals`),
    enabled: !!branch,
  });
  const myBookings = useQuery({
    queryKey: ['my-bookings', me?.id],
    queryFn: () => api('/bookings'),
    enabled: me?.role === 'customer' && tab === 'visits',
    refetchInterval: 15000,
  });
  const total = services.reduce(
    (n, sid) => n + Number(catalogue.data?.find((svc: any) => svc.id === sid)?.price_minor || 0),
    0,
  );
  const ur = locale === 'ur';
  const selectedBranch = branches.data?.find((b: any) => b.id === branch);
  async function search() {
    setBusy(true);
    setError('');
    try {
      const p = await post('/availability/search', {
        branch_id: branch,
        service_ids: services,
        date,
        earliest,
        professional_id: pro || undefined,
      });
      setPlans(p);
      setSelected(null);
      setStage(1);
      if (!p.length)
        setError(
          'There are no complete visit times for these choices. Try another day or any professional.',
        );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function sendCode() {
    setBusy(true);
    setError('');
    try {
      const c = await post('/auth/otp/challenges', { phone: phoneValue });
      setChallenge(c);
      if (c.demo_code) setCode(c.demo_code);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function verifyCode() {
    setBusy(true);
    setError('');
    try {
      const result = await post('/auth/otp/verify', {
        challenge_id: challenge.challenge_id,
        code,
        name,
        branch_id: branch,
      });
      setCsrf(result.csrf);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      notify('Your number is verified.');
      if (signInOnly) {
        setSignInOnly(false);
        setTab('visits');
      } else await search();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const holdRef = useRef<any>(null),
    bookingKey = useRef(crypto.randomUUID());
  async function confirm() {
    setBusy(true);
    setError('');
    try {
      if (!policy) throw new Error('Please review and accept the booking policy.');
      let held = holdRef.current;
      if (!held) {
        const fresh = await currentQuote(selected, {
          branch_id: branch,
          service_ids: services,
          date,
          professional_id: pro || undefined,
        });
        held = await post(
          '/booking-holds',
          {
            quote_id: fresh.quote_id,
            plan_fingerprint: fresh.plan_fingerprint,
            accepted_policy: true,
            source: 'customer',
          },
          undefined,
          bookingKey.current,
        );
        holdRef.current = held;
      }
      const b = await post(
        `/booking-holds/${held.id}/confirm`,
        {},
        undefined,
        bookingKey.current + '-confirm',
      );
      setConfirmed(b);
      setStage(3);
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="customer-app" dir={ur ? 'rtl' : 'ltr'}>
      <header className="customer-header">
        <Link to="/book" className="brand" onClick={() => setTab('book')}>
          <Flower2 size={31} strokeWidth={1} />
          <span>
            aurelle<sup>®</sup>
          </span>
        </Link>
        <div className="customer-nav">
          <button className={tab === 'book' ? 'active' : ''} onClick={() => setTab('book')}>
            {ur ? 'وقت بک کریں' : 'Book a little care'}
          </button>
          <button className={tab === 'visits' ? 'active' : ''} onClick={() => setTab('visits')}>
            {ur ? 'میرے دورے' : 'My visits'}
          </button>
        </div>
        <div className="flex gap">
          <button className="locale-btn" onClick={() => setLocale(ur ? 'en' : 'ur')}>
            <Globe size={15} />
            {ur ? 'English' : 'اردو'}
          </button>
          {me?.role === 'customer' && (
            <button
              className="text-link"
              onClick={async () => {
                await post('/auth/logout');
                await queryClient.invalidateQueries({ queryKey: ['me'] });
                setTab('book');
              }}
            >
              Sign out
            </button>
          )}
          <Link to="/" className="text-link">
            Studio workspace
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </header>
      {config?.demo && (
        <div className="customer-demo">
          <span className="status-dot" />
          Sample salon · Synthetic services, prices, and availability. No online payment or live
          message is sent.
        </div>
      )}
      {tab === 'book' ? (
        <>
          <section className="customer-hero">
            <div className="hero-copy">
              <div className="eyebrow">AURELLE STUDIO · LAHORE</div>
              <h1>
                {ur ? (
                  <>
                    اپنے لیے
                    <br />
                    <em>کچھ وقت۔</em>
                  </>
                ) : (
                  <>
                    A little time.
                    <br />
                    Entirely <em>yours.</em>
                  </>
                )}
              </h1>
              <p>
                {ur
                  ? 'توجہ، سکون اور خوبصورتی کے لیے ایک لمحہ۔ اپنی پسند کی خدمات اور مناسب وقت منتخب کریں۔'
                  : 'Good hair days. A quiet moment. The feeling of being cared for. Make room for your kind of beautiful.'}
              </p>
              <div className="hero-tags">
                <span>
                  <Leaf size={15} />
                  {ur ? 'خلوص سے دیکھ بھال' : 'Thoughtful care'}
                </span>
                <span>
                  <Clock size={15} />
                  {ur ? 'آپ کا وقت محفوظ' : 'Your time, reserved'}
                </span>
                <span>
                  <Heart size={15} />
                  {ur ? 'صرف آپ کے لیے' : 'Always personal'}
                </span>
              </div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="hero-arch">
                <Flower2 className="flower-large" size={218} strokeWidth={0.45} />
                <Leaf className="leaf-large" size={130} strokeWidth={0.5} />
                <div className="arch-caption">
                  THE ART OF
                  <br />
                  <em>feeling like yourself.</em>
                </div>
              </div>
              <div className="art-circle" />
              <span className="vertical-art-label">A LITTLE CARE GOES A LONG WAY.</span>
              <span className="art-star">✳</span>
            </div>
          </section>
          <section className="customer-booking" id="booking">
            <div className="booking-section-head">
              <div>
                <div className="eyebrow">YOUR NEXT LITTLE RITUAL</div>
                <h2>
                  {stage === 3
                    ? 'A lovely thing to look forward to.'
                    : ur
                      ? 'آپ کی اگلی ملاقات'
                      : 'Let’s make room for you.'}
                </h2>
              </div>
              <div className="customer-progress">
                {['Choose your care', 'Find your time', 'Make it yours'].map((label, i) => (
                  <span key={label} className={stage >= i ? 'current' : ''}>
                    <i>{stage > i ? <Check size={12} /> : i + 1}</i>
                    <span>{label}</span>
                  </span>
                ))}
              </div>
            </div>
            {stage === 0 ? (
              <div className="customer-book-grid">
                <div>
                  <div className="field-pair">
                    <Field label={ur ? 'اسٹوڈیو منتخب کریں' : 'Choose your studio'}>
                      <select
                        value={branch}
                        onChange={(e) => {
                          setBranchLocal(e.target.value);
                          setServices([]);
                          setPro('');
                        }}
                      >
                        {branches.data?.map((b: any) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={ur ? 'تاریخ' : 'A date that suits you'}>
                      <input
                        type="date"
                        min={dateNow()}
                        max={shiftDate(dateNow(), 90)}
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="category-tabs large-tabs">
                    {['All', 'Hair', 'Skin', 'Nails', 'Makeup'].map((c) => (
                      <button
                        key={c}
                        className={c === category ? 'selected' : ''}
                        onClick={() => setCategory(c)}
                      >
                        {c === 'All' ? 'All care' : c}
                      </button>
                    ))}
                  </div>
                  <div className="customer-services">
                    {catalogue.isPending ? (
                      <p>Gathering our little rituals…</p>
                    ) : (
                      catalogue.data
                        ?.filter((svc: any) => category === 'All' || svc.category === category)
                        .map((svc: any) => (
                          <button
                            className={`customer-service ${services.includes(svc.id) ? 'chosen' : ''}`}
                            key={svc.id}
                            onClick={() =>
                              setServices(
                                services.includes(svc.id)
                                  ? services.filter((x) => x !== svc.id)
                                  : services.length < 6
                                    ? [...services, svc.id]
                                    : services,
                              )
                            }
                          >
                            <span
                              className={`service-glyph ${{ Hair: 'sage', Skin: 'lavender', Nails: 'peach', Makeup: 'sand' }[svc.category as 'Hair']}`}
                            >
                              {svc.category === 'Hair' ? (
                                <Scissors size={23} strokeWidth={1.3} />
                              ) : (
                                <Flower2 size={23} strokeWidth={1.3} />
                              )}
                            </span>
                            <div>
                              <strong>{svc.name}</strong>
                              <p>{svc.data.description}</p>
                              <small>{svc.duration} min incl. reset</small>
                            </div>
                            <span>
                              <strong>{currency(svc.price_minor)}</strong>
                              <i className="customer-service-check">
                                {services.includes(svc.id) ? (
                                  <Check size={14} />
                                ) : (
                                  <Plus size={14} />
                                )}
                              </i>
                            </span>
                          </button>
                        ))
                    )}
                  </div>
                </div>
                <aside className="customer-summary">
                  <Flower2 size={31} strokeWidth={1} />
                  <h3>Your little moment.</h3>
                  <p>{selectedBranch?.name}</p>
                  {services.length ? (
                    services.map((sid) => {
                      const svc = catalogue.data?.find((svc: any) => svc.id === sid);
                      return (
                        <div className="summary-line" key={sid}>
                          <span>{svc?.name}</span>
                          <strong>{money(svc?.price_minor || 0)}</strong>
                        </div>
                      );
                    })
                  ) : (
                    <p className="muted">
                      Choose the services that feel right for you. We’ll take care of the rest.
                    </p>
                  )}
                  <div className="review-total">
                    <span>Total · PKR</span>
                    <strong>{money(total)}</strong>
                  </div>
                  <Field label="Start after">
                    <input
                      type="time"
                      value={earliest}
                      onChange={(e) => setEarliest(e.target.value)}
                    />
                  </Field>
                  <Field label="Professional preference">
                    <select value={pro} onChange={(e) => setPro(e.target.value)}>
                      <option value="">Any qualified professional</option>
                      {professionals.data?.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button
                    className="btn primary full"
                    disabled={busy || !services.length}
                    onClick={search}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : ur ? (
                      'وقت تلاش کریں'
                    ) : (
                      'Find my time'
                    )}
                    <ArrowRight size={17} />
                  </button>
                  <small>Pay at the salon. No online deposit.</small>
                  <ErrorText error={error} />
                </aside>
              </div>
            ) : stage === 1 ? (
              <div className="customer-time-card card">
                <div>
                  <button
                    className="text-link"
                    onClick={() => {
                      setStage(0);
                      setError('');
                    }}
                  >
                    <ArrowLeft size={15} />
                    Back to your care
                  </button>
                  <h3>A lovely time on {dayLabel(date)}.</h3>
                  <p className="muted">
                    Your complete visit is reserved around qualified professionals and available
                    stations.
                  </p>
                  <div className="slot-grid">
                    {plans.map((p) => (
                      <button
                        key={p.quote_id}
                        className={selected?.quote_id === p.quote_id ? 'selected' : ''}
                        onClick={() => setSelected(p)}
                      >
                        <strong>{time(p.starts_at)}</strong>
                        <small>until {time(p.ends_at)}</small>
                      </button>
                    ))}
                  </div>
                  <button className="text-link" disabled={busy} onClick={search}>
                    <RefreshCw size={14} />
                    Refresh available times
                  </button>
                </div>
                <aside className="customer-time-summary">
                  <h3>A moment, made just for you.</h3>
                  {selected?.steps
                    .filter((st: any) => st.phase !== 'Station reset')
                    .map((st: any, i: number) => (
                      <div className="summary-line" key={i}>
                        <div>
                          <strong>{st.phase}</strong>
                          <small>
                            {st.professional_name} · {time(st.starts_at)}
                          </small>
                        </div>
                      </div>
                    ))}
                  <div className="review-total">
                    <span>Visit total</span>
                    <strong>{currency(total)}</strong>
                  </div>
                  <p className="muted small-text">
                    A time is reserved only after you confirm. Quotes are valid for 30 seconds and
                    are rechecked before booking.
                  </p>
                  <button
                    className="btn primary full"
                    disabled={!selected}
                    onClick={() => {
                      setStage(2);
                      setError('');
                    }}
                  >
                    Make it mine
                    <ArrowRight size={16} />
                  </button>
                </aside>
                <ErrorText error={error} />
              </div>
            ) : stage === 2 ? (
              <div className="customer-verify card">
                <button
                  className="text-link"
                  onClick={() => {
                    setStage(1);
                    setError('');
                  }}
                >
                  <ArrowLeft size={15} />
                  Back to times
                </button>
                <h3>
                  {me?.role === 'customer'
                    ? 'The lovely little details.'
                    : 'A little hello before we meet.'}
                </h3>
                {me?.role === 'customer' ? (
                  <>
                    <p>Welcome, {me.name}. Your number is verified.</p>
                    <div className="visit-review">
                      <strong>
                        {dayLabel(date, true)} · {time(selected.starts_at)}
                      </strong>
                      <div className="plan-timeline">
                        {selected.steps.map((st: any, i: number) => (
                          <div key={i}>
                            <span className="timeline-dot" />
                            <div>
                              <strong>{st.phase}</strong>
                              <small>
                                {time(st.starts_at)}—{time(st.ends_at)} · {st.professional_name}
                              </small>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="review-total">
                        <span>Pay at salon</span>
                        <strong>{currency(selected.total_minor)}</strong>
                      </div>
                    </div>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={policy}
                        onChange={(e) => setPolicy(e.target.checked)}
                      />
                      <span>
                        I agree to the services and price, and the{' '}
                        {selectedBranch?.data.cancellation_hours || 12}-hour cancellation policy. I
                        will contact reception for late changes.
                      </span>
                    </label>
                    <button
                      className="btn primary full"
                      disabled={busy || !policy}
                      onClick={confirm}
                    >
                      {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={17} />}
                      Confirm my little moment
                    </button>
                  </>
                ) : (
                  <>
                    <p>Verify your mobile number so your visits stay yours.</p>
                    {me && me.role !== 'customer' ? (
                      <div className="notice warm">
                        <UserRound size={20} />
                        <div>
                          <strong>You’re signed in to the studio workspace.</strong>
                          <p>Use a customer session to make a personal booking.</p>
                          <button
                            className="text-link"
                            onClick={async () => {
                              await post('/auth/logout');
                              queryClient.invalidateQueries({ queryKey: ['me'] });
                            }}
                          >
                            Sign out & verify a customer number
                            <ArrowRight size={15} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Field label="Your full name">
                          <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="A name for your warm welcome"
                            autoComplete="name"
                          />
                        </Field>
                        <Field label="Mobile number">
                          <input
                            type="tel"
                            value={phoneValue}
                            onChange={(e) => setPhoneValue(e.target.value)}
                            placeholder="0300 1234567"
                            dir="ltr"
                            autoComplete="tel"
                          />
                        </Field>
                        {challenge ? (
                          <>
                            <Field label="6-digit verification code">
                              <input
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                maxLength={6}
                                inputMode="numeric"
                                autoComplete="one-time-code"
                              />
                            </Field>
                            {challenge.demo_code && (
                              <div className="form-note">
                                Development only · Your sample code is {challenge.demo_code}. No SMS
                                was sent.
                              </div>
                            )}
                            <button
                              className="btn primary full"
                              disabled={busy || code.length !== 6 || name.length < 2}
                              onClick={verifyCode}
                            >
                              Verify & refresh my times
                              <ArrowRight size={16} />
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn primary full"
                            disabled={busy || name.length < 2 || phoneValue.length < 10}
                            onClick={sendCode}
                          >
                            Send verification code
                            <ArrowRight size={16} />
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
                <ErrorText error={error} />
                <div className="form-note">
                  <ShieldCheck size={16} />
                  No payment card needed. Your booking is confirmed only after the server reserves
                  your full visit.
                </div>
              </div>
            ) : (
              <div className="confirmation customer-confirmation">
                <div className="success-flower">
                  <Check size={32} />
                </div>
                <span className="eyebrow">A LITTLE CARE, CONFIRMED</span>
                <h3>Your moment is reserved.</h3>
                <p>{confirmed?.reference}</p>
                <strong>
                  {dayLabel(date, true)} · {time(confirmed?.starts_at)}
                </strong>
                <p className="muted">
                  Your visit pass is waiting in My visits. Please arrive 10 minutes early.
                </p>
                <button
                  className="btn primary"
                  onClick={() => {
                    setTab('visits');
                    setStage(0);
                    setServices([]);
                    setConfirmed(null);
                    holdRef.current = null;
                    bookingKey.current = crypto.randomUUID();
                  }}
                >
                  View my visit pass
                  <ArrowRight size={17} />
                </button>
              </div>
            )}
          </section>
          <section className="customer-bottom-story">
            <span className="eyebrow">THE LITTLE THINGS ARE THE BIG THINGS</span>
            <h2>
              Come as you are.
              <br />
              <em>Leave feeling like you.</em>
            </h2>
            <div className="customer-contact">
              <span>
                <MapPin size={17} />
                {selectedBranch?.data.address}
              </span>
              <a href={`tel:${selectedBranch?.data.phone.replaceAll(' ', '')}`}>
                <Phone size={17} />
                {selectedBranch?.data.phone}
              </a>
              <span>
                <Clock size={17} />
                {selectedBranch?.data.open}–{selectedBranch?.data.close} · Asia/Karachi
              </span>
            </div>
          </section>
        </>
      ) : (
        <section className="my-visits">
          <PageHeading
            eyebrow="LITTLE MOMENTS TO LOOK FORWARD TO"
            title={ur ? 'میرے دورے' : 'Your care, all in one place.'}
            description="Your confirmed visits, current visit passes, and a little peace of mind."
          />
          {me?.role === 'customer' ? (
            myBookings.isPending ? (
              <p>Finding your visits…</p>
            ) : myBookings.data?.length ? (
              <div className="my-visit-grid">
                {myBookings.data.map((b: any) => (
                  <section className="card my-visit" key={b.id}>
                    <div className="flex between">
                      <span className="eyebrow">{b.reference}</span>
                      <Badge status={b.status} />
                    </div>
                    <h2>
                      {b.plan.steps[0]?.service_name}
                      {b.plan.service_ids.length > 1
                        ? ` + ${b.plan.service_ids.length - 1} more`
                        : ''}
                    </h2>
                    <p>
                      <CalendarDays size={16} />
                      {dayLabel(new Date(b.starts_at).toISOString().slice(0, 10), true)}
                    </p>
                    <p>
                      <Clock size={16} />
                      {time(b.starts_at)} — {time(b.ends_at)}
                    </p>
                    <p>
                      <Scissors size={16} />
                      {b.plan.steps[0]?.professional_name}
                    </p>
                    <div className="review-total">
                      <span>Visit total</span>
                      <strong>{currency(b.total_minor)}</strong>
                    </div>
                    {['CONFIRMED', 'FULFILLED'].includes(b.status) && (
                      <button
                        className="btn primary full"
                        onClick={async () => {
                          try {
                            setPass(await api(`/bookings/${b.id}/pass`));
                          } catch (e: any) {
                            notify(e.message, 'error');
                          }
                        }}
                      >
                        <ScanLine size={17} />
                        View my visit pass
                      </button>
                    )}
                    {b.status === 'CONFIRMED' && !b.arrived_at && (
                      <button
                        className="text-link text-rust"
                        onClick={() => {
                          setCancel(b);
                          setCancelReason('');
                          setError('');
                        }}
                      >
                        Cancel this visit
                      </button>
                    )}
                    <small className="muted">
                      For rescheduling or last-minute changes, please call your studio.
                    </small>
                  </section>
                ))}
              </div>
            ) : (
              <Empty
                title="A little care is waiting"
                description="You haven’t booked your next moment yet."
                action={
                  <button className="btn primary" onClick={() => setTab('book')}>
                    Find my little moment
                    <ArrowRight size={16} />
                  </button>
                }
              />
            )
          ) : (
            <Empty
              title="Your visits belong to you."
              description="Verify your mobile number during booking to access your personal visits. If you’re a studio team member, switch to a customer session first."
              action={
                <div className="flex gap">
                  <button
                    className="btn primary"
                    onClick={() => {
                      setSignInOnly(true);
                      setError('');
                    }}
                  >
                    Verify my mobile
                    <Phone size={16} />
                  </button>
                  <button className="btn" onClick={() => setTab('book')}>
                    Book a visit
                    <ArrowRight size={16} />
                  </button>
                </div>
              }
            />
          )}
        </section>
      )}
      <footer className="customer-footer">
        <div className="brand">
          <Flower2 size={23} strokeWidth={1} />
          <span>
            aurelle<sup>®</sup>
          </span>
        </div>
        <span>THE ART OF EVERYDAY CARE.</span>
        <span>Made for your kind of beautiful.</span>
      </footer>
      {pass && (
        <Modal
          title="Your little invitation."
          subtitle="Show your current pass when you arrive at reception."
          onClose={() => setPass(null)}
        >
          <div className="customer-pass">
            <img src={pass.qr} alt="Your secure visit pass QR code" />
            <h3 dir="ltr">{pass.reference}</h3>
            <p>
              No contact details are stored in this QR code. Cancelled and replaced passes stop
              working.
            </p>
            <a href={pass.qr} download={`Aurelle-${pass.reference}.png`} className="btn primary">
              <Download size={17} />
              Save my visit pass
            </a>
          </div>
        </Modal>
      )}
      {signInOnly && (
        <Modal
          title="Your visits belong to you."
          subtitle="A quick mobile verification keeps your appointments private."
          onClose={() => setSignInOnly(false)}
        >
          {me && me.role !== 'customer' ? (
            <div className="notice warm">
              <UserRound size={20} />
              <div>
                <strong>You are signed in to the studio workspace.</strong>
                <p>Sign out of your workforce session before verifying a customer number.</p>
                <button
                  className="text-link"
                  onClick={async () => {
                    await post('/auth/logout');
                    queryClient.invalidateQueries({ queryKey: ['me'] });
                  }}
                >
                  Sign out of workspace
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          ) : (
            <>
              <Field label="Your full name">
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </Field>
              <Field label="Mobile number">
                <input
                  type="tel"
                  value={phoneValue}
                  onChange={(e) => setPhoneValue(e.target.value)}
                  placeholder="0300 1234567"
                  autoComplete="tel"
                />
              </Field>
              {challenge ? (
                <>
                  <Field label="Verification code">
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      maxLength={6}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                    />
                  </Field>
                  {challenge.demo_code && (
                    <div className="form-note">
                      Sample code: {challenge.demo_code}. No SMS sent.
                    </div>
                  )}
                  <button
                    className="btn primary full"
                    disabled={busy || code.length !== 6 || name.length < 2}
                    onClick={verifyCode}
                  >
                    Verify & view my visits
                    <ArrowRight size={16} />
                  </button>
                </>
              ) : (
                <button
                  className="btn primary full"
                  disabled={busy || name.length < 2 || phoneValue.length < 10}
                  onClick={sendCode}
                >
                  Send verification code
                  <ArrowRight size={16} />
                </button>
              )}
              <ErrorText error={error} />
            </>
          )}
        </Modal>
      )}
      {cancel && (
        <Modal
          title="A little change of plans?"
          subtitle="Cancellation releases your reserved time and invalidates the current pass."
          onClose={() => setCancel(null)}
        >
          <Field label="Reason for cancelling">
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
            />
          </Field>
          <ErrorText error={error} />
          <div className="modal-actions">
            <button className="btn" onClick={() => setCancel(null)}>
              Keep my visit
            </button>
            <button
              className="btn danger"
              disabled={busy || cancelReason.length < 3}
              onClick={async () => {
                setBusy(true);
                try {
                  await post(
                    `/bookings/${cancel.id}/cancel`,
                    { reason: cancelReason },
                    cancel.version,
                  );
                  notify('Your visit has been cancelled.');
                  setCancel(null);
                  queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
                } catch (e: any) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm cancellation
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function ReceiptPage() {
  const location = useLocation();
  const { notify, me } = useUI();
  const receiptId = location.pathname.split('/').at(-1);
  const [refund, setRefund] = useState(false),
    [amount, setAmount] = useState(''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<any>(null);
  const q = useQuery({
    queryKey: ['receipt', receiptId],
    queryFn: () => api(`/receipts/${receiptId}`),
  });
  if (q.isPending) return <div className="page-loading">Gathering the little details…</div>;
  if (q.isError)
    return (
      <div className="receipt-page">
        <Empty
          title="This receipt is unavailable"
          description={(q.error as Error).message}
          action={
            <Link className="btn primary" to="/">
              Return to workspace
            </Link>
          }
        />
      </div>
    );
  const r = q.data.snapshot;
  return (
    <div className="receipt-page">
      <div className="receipt-toolbar no-print">
        <Link className="text-link" to="/">
          <ArrowLeft size={16} />
          Back to studio
        </Link>
        <button className="btn primary" onClick={() => window.print()}>
          <Printer size={17} />
          Print receipt
        </button>
      </div>
      <article className="receipt-paper">
        <div className="brand">
          <Flower2 size={35} strokeWidth={1} />
          <span>
            aurelle<sup>®</sup>
          </span>
        </div>
        <span className="eyebrow">A LITTLE CARE, BEAUTIFULLY ACCOUNTED FOR</span>
        <h2>{r.branch_name}</h2>
        <p>{r.address || 'Aurelle Studio · Lahore'}</p>
        <div className="receipt-info">
          <div>
            <small>RECEIPT</small>
            <strong>{r.invoice_number || r.reference}</strong>
          </div>
          <div>
            <small>ISSUED</small>
            <strong>
              {new Date(r.issued_at).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })} PKT
            </strong>
          </div>
        </div>
        <p>
          Prepared for <strong>{r.customer_name}</strong>
        </p>
        <table>
          <thead>
            <tr>
              <th>A little care</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((line: any, i: number) => (
              <tr key={i}>
                <td>{line.name}</td>
                <td>{currency(line.amount_minor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="receipt-totals">
          <div>
            <span>Visit total</span>
            <strong>{currency(r.total_minor)}</strong>
          </div>
          <div>
            <span>
              This payment · {r.tender === 'bank_verified' ? 'Verified bank transfer' : 'Cash'}
            </span>
            <strong>{currency(r.paid_minor)}</strong>
          </div>
          <div>
            <span>Balance after this payment</span>
            <strong>{currency(r.balance_minor || 0)}</strong>
          </div>
        </div>
        <div className="receipt-thanks">
          <Flower2 size={25} strokeWidth={1} />
          <h3>Thank you for your little moment.</h3>
          <p>We look forward to caring for you again.</p>
        </div>
        <small className="receipt-checksum">
          Immutable receipt · {q.data.checksum.slice(0, 24)}
          <br />
          No tax configured · Currency PKR
        </small>
      </article>
      {['owner', 'manager'].includes(me?.role) && (
        <div className="refund-box no-print">
          <button className="text-link text-rust" onClick={() => setRefund(!refund)}>
            <RefreshCw size={15} />
            Issue cash refund
          </button>
          {refund && (
            <div className="inline-panel">
              <Field label="Refund amount (PKR)">
                <input
                  type="number"
                  min="1"
                  max={Number(r.paid_minor) / 100}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="Refund reason">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={5}
                  rows={3}
                />
              </Field>
              <button
                className="btn danger"
                disabled={busy || !amount || reason.length < 5}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const response = await post(`/payments/${r.payment_id}/refunds`, {
                      amount_minor: String(Math.round(Number(amount) * 100)),
                      reason,
                    });
                    setResult(response);
                    notify('Cash refund recorded with reversing ledger entries.');
                    setRefund(false);
                  } catch (e: any) {
                    notify(e.message, 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Record refund
              </button>
            </div>
          )}
          {result && (
            <p>Refund recorded: {currency(result.amount_minor)}. Original receipt preserved.</p>
          )}
        </div>
      )}
    </div>
  );
}
