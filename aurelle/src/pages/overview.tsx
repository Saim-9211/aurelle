import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  Flower2,
  Heart,
  Leaf,
  Plus,
  Scissors,
  Sparkles,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { dayLabel, money } from '../api';
import { Schedule } from '../components/schedule';
import { Avatar, DateNav, Empty, Metric, PageHeading } from '../components/ui';
import { useUI } from '../context';
export function Overview() {
  const { state: s, me, date, openBooking, openDetail } = useUI();
  const navigate = useNavigate();
  const bookings = s.bookings.filter(
    (b: any) => !['CANCELLED', 'EXPIRED', 'HELD'].includes(b.status),
  );
  const collected = s.history.find((h: any) => h.date === date)?.amount || '0';
  const active = s.steps.filter((st: any) => st.state === 'ACTIVE');
  const arrived = s.bookings.filter((b: any) => b.arrived_at && b.visit_status !== 'CLOSED');
  const completed = bookings.filter((b: any) => b.status === 'FULFILLED').length;
  const revenue = s.history.map((h: any) => ({
    name: dayLabel(h.date).split(',')[0],
    revenue: Number(h.amount) / 100,
  }));
  const counts = s.services
    .map((svc: any) => ({
      name: svc.category,
      count: bookings.filter((b: any) => b.plan.service_ids.includes(svc.id)).length,
    }))
    .reduce((map: any, item: any) => {
      map[item.name] = (map[item.name] || 0) + item.count;
      return map;
    }, {});
  const mix = Object.entries(counts).sort((a: any, b: any) => b[1] - a[1]);
  return (
    <>
      <PageHeading
        eyebrow={dayLabel(date, true).toUpperCase()}
        title={`A beautiful day starts here, ${me.name.split(' ')[0]}.`}
        description="A little clarity for your day. More room for what you do best."
        actions={
          <>
            <button className="btn" onClick={() => openBooking(true)}>
              <UserRound size={17} /> Add walk-in
            </button>
            <button className="btn primary" onClick={() => openBooking()}>
              <Plus size={18} /> New appointment
            </button>
          </>
        }
      />
      <div className="welcome-strip">
        <span className="welcome-leaf">
          <Leaf size={23} strokeWidth={1.3} />
        </span>
        <span>
          <strong>Your studio, in a good place.</strong> {bookings.length} appointments on the
          books. Let’s make every visit feel special.
        </span>
        <Link to="/queue">
          View live queue <ArrowRight size={16} />
        </Link>
      </div>
      <div className="metrics-grid">
        <Metric
          label="Today's appointments"
          value={String(bookings.length).padStart(2, '0')}
          icon={CalendarCheck}
          foot={`${completed} completed`}
          accent="sage"
          trend={`${bookings.filter((b: any) => b.source === 'walk_in').length} walk-ins`}
        />
        <Metric
          label="Collected today"
          value={money(collected)}
          prefix="PKR"
          icon={Wallet}
          foot="Payments received"
          accent="peach"
          trend="Cash & verified bank"
        />
        <Metric
          label="Clients in studio"
          value={String(arrived.length).padStart(2, '0')}
          icon={Users}
          foot={`${active.length} currently in service`}
          accent="lavender"
          trend={`${s.steps.filter((st: any) => st.state === 'READY').length} waiting`}
        />
        <Metric
          label="Team on the floor"
          value={String(s.professionals.filter((p: any) => p.active).length).padStart(2, '0')}
          icon={Scissors}
          foot="Qualified professionals"
          accent="sand"
          trend={`${s.professionals.length - active.filter((st: any) => st.data.staff).length} between services`}
        />
      </div>
      <div className="overview-main">
        <section className="card schedule-card">
          <div className="card-heading">
            <div>
              <h2>
                The day, at a glance <span className="count-pill">{bookings.length}</span>
              </h2>
              <p>A little structure. A seamless day.</p>
            </div>
            <div className="flex gap">
              <DateNav />
              <Link
                to="/calendar"
                className="icon-link"
                aria-label="Open full appointment calendar"
              >
                <ArrowUpRight size={19} />
              </Link>
            </div>
          </div>
          <Schedule compact />
        </section>
        <section className="card studio-now">
          <div className="card-heading">
            <div>
              <h2>In the studio</h2>
              <p>Every client, a little closer to cared for.</p>
            </div>
            <span className="live-label">
              <span /> LIVE
            </span>
          </div>
          <div className="queue-summary">
            <span>
              <i className="dot sage-bg" />
              {active.length} in service
            </span>
            <span>
              <i className="dot peach-bg" />
              {s.steps.filter((st: any) => st.state === 'READY').length} waiting
            </span>
          </div>
          <div className="studio-client-list">
            {arrived.length ? (
              arrived.slice(0, 4).map((b: any, i: number) => {
                const st = s.steps.find(
                  (st: any) =>
                    st.booking_id === b.id && ['ACTIVE', 'READY', 'CALLED'].includes(st.state),
                );
                return (
                  <button className="studio-client" key={b.id} onClick={() => openDetail(b)}>
                    <Avatar
                      name={b.customer_name}
                      color={['peach', 'sage', 'lavender', 'sand'][i % 4]}
                    />
                    <div className="client-info">
                      <strong>{b.customer_name}</strong>
                      <small>{st?.data.service_name || 'Ready for checkout'}</small>
                      <span>
                        {st?.data.professional_name || 'Reception'}{' '}
                        {st && '· ' + st.data.resource_name}
                      </span>
                    </div>
                    <span className={`tiny-state ${st?.state === 'ACTIVE' ? 'green' : 'orange'}`}>
                      {st?.state === 'ACTIVE'
                        ? 'In service'
                        : b.visit_status === 'CHECKOUT'
                          ? 'Checkout'
                          : 'Waiting'}
                    </span>
                  </button>
                );
              })
            ) : (
              <Empty
                title="A quiet moment"
                description="Clients will appear here as they check in."
              />
            )}
          </div>
          <Link to="/queue" className="card-bottom-link">
            Open live queue <ArrowRight size={16} />
          </Link>
          <div className="studio-art">
            <Flower2 size={82} strokeWidth={0.55} />
            <div>
              <span>GOOD CARE STARTS WITH</span>
              <p>a little more presence.</p>
            </div>
            <Leaf size={55} strokeWidth={0.6} />
          </div>
        </section>
      </div>
      <div className="overview-bottom">
        <section className="card revenue-card">
          <div className="card-heading">
            <div>
              <h2>A little growth, every day</h2>
              <p>Collected payments · the last 7 days</p>
            </div>
            <Link to="/reports" className="text-link">
              View report <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="chart-meta">
            <strong>
              <span>PKR</span>{' '}
              {money(s.history.reduce((n: number, h: any) => n + Number(h.amount), 0))}
            </strong>
            <small>Sample data {me.demo ? '· illustrative studio activity' : ''}</small>
          </div>
          <div className="revenue-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenue} margin={{ top: 10, right: 5, bottom: 0, left: -15 }}>
                <defs>
                  <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#bc7d63" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#bc7d63" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#eae7e1" />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: '#817d73' }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: '#817d73' }}
                  tickFormatter={(v) => `${v / 1000}k`}
                />
                <Tooltip
                  formatter={(v: any) => [`PKR ${Number(v).toLocaleString()}`, 'Collected']}
                  contentStyle={{ borderRadius: 10, border: '1px solid #e7e3dc', fontSize: 12 }}
                />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="revenue"
                  stroke="#af7058"
                  strokeWidth={2.2}
                  fill="url(#revenueFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card service-mix">
          <div className="card-heading">
            <div>
              <h2>What clients are loving</h2>
              <p>Today’s service mix</p>
            </div>
            <Scissors size={19} strokeWidth={1.4} />
          </div>
          <div className="mix-bars">
            {mix.map(([name, count]: any, i: number) => (
              <div className="mix-row" key={name}>
                <span className={`mix-icon ${['sage', 'peach', 'lavender', 'sand'][i % 4]}`}>
                  {name === 'Hair' ? (
                    <Scissors size={17} />
                  ) : name === 'Nails' ? (
                    <Sparkles size={17} />
                  ) : (
                    <Flower2 size={17} />
                  )}
                </span>
                <div>
                  <div>
                    <strong>{name}</strong>
                    <span>{count} bookings</span>
                  </div>
                  <div className="bar-track">
                    <span
                      className={['sage-bg', 'peach-bg', 'lavender-bg', 'sand-bg'][i % 4]}
                      style={{ width: `${bookings.length ? (count / bookings.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mix-foot">
            <Heart size={14} /> Thoughtful service. Lasting impressions.
          </p>
        </section>
      </div>
    </>
  );
}
