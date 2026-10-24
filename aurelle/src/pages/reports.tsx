import {
  Clock,
  Download,
  Leaf,
  LoaderCircle,
  RefreshCw,
  Scissors,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { currency, dayLabel, money, post, time } from '../api';
import { Avatar, DateNav, Metric, PageHeading } from '../components/ui';
import { useUI } from '../context';
import { awaitJob, downloadFile } from '../utils';
export function ReportsPage() {
  const { state: s, date, notify, me } = useUI();
  const [brief, setBrief] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const collected = Number(s.history.find((h: any) => h.date === date)?.amount || 0);
  const scheduled = s.bookings.filter(
    (b: any) => !['CANCELLED', 'EXPIRED', 'HELD'].includes(b.status),
  );
  const billed = scheduled
    .filter((b: any) => b.status === 'FULFILLED')
    .reduce((n: number, b: any) => n + Number(b.total_minor), 0);
  const unpaid = scheduled
    .filter((b: any) => b.status === 'FULFILLED')
    .reduce((n: number, b: any) => n + Number(b.total_minor) - Number(b.paid_minor), 0);
  function exportReport() {
    const rows = [
      ['Metric', 'Amount PKR', 'Date'],
      ['Collected', String(collected / 100), date],
      ['Delivered service value', String(billed / 100), date],
      ['Unpaid delivered value', String(unpaid / 100), date],
      ['Refunds', String(Number(s.refund_minor) / 100), date],
      ['Net collected', String((collected - Number(s.refund_minor)) / 100), date],
    ];
    downloadFile(
      rows.map((r) => r.join(',')).join('\r\n'),
      `aurelle-report-${date}.csv`,
      'text/csv',
    );
    notify('Aggregate report exported.');
  }
  return (
    <>
      <PageHeading
        eyebrow="A CLEARER VIEW OF YOUR GOOD WORK"
        title="The story behind your studio."
        description="A little perspective on the time, care, and revenue that shape your business."
        actions={
          <>
            <DateNav />
            <button className="btn" onClick={exportReport}>
              <Download size={17} />
              Export report
            </button>
          </>
        }
      />
      <div className="metrics-grid">
        <Metric
          label="Collected payments"
          value={money(collected)}
          prefix="PKR"
          icon={Wallet}
          accent="sage"
          foot="Cash + verified bank receipts"
          trend="By payment date"
        />
        <Metric
          label="Delivered service value"
          value={money(billed)}
          prefix="PKR"
          icon={Scissors}
          accent="peach"
          foot="Fulfilled appointments"
          trend="Before refunds"
        />
        <Metric
          label="Unpaid service value"
          value={money(unpaid)}
          prefix="PKR"
          icon={Clock}
          accent="lavender"
          foot="Delivered but uncollected"
          trend="Follow up at checkout"
        />
        <Metric
          label="Refunds issued"
          value={money(s.refund_minor)}
          prefix="PKR"
          icon={RefreshCw}
          accent="sand"
          foot="Cash refunds recorded today"
          trend="Immutable ledger entries"
        />
      </div>
      <div className="reports-grid">
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>A week of thoughtful work</h2>
              <p>Payments received, grouped by local payment date</p>
            </div>
            <span className="tag">PKR</span>
          </div>
          <div className="report-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={s.history.map((h: any) => ({
                  day: dayLabel(h.date),
                  collected: Number(h.amount) / 100,
                }))}
                margin={{ left: 0, right: 30, top: 20, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="#e8e4dc" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis
                  tickFormatter={(v) => `${v / 1000}k`}
                  tick={{ fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v: any) => [`PKR ${Number(v).toLocaleString()}`, 'Collected']}
                />
                <Area
                  isAnimationActive={false}
                  dataKey="collected"
                  type="monotone"
                  fill="#edf0e6"
                  stroke="#869575"
                  strokeWidth={2.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card report-definitions">
          <div className="card-heading">
            <h2>Numbers with meaning.</h2>
            <Leaf size={19} />
          </div>
          <div>
            <h4>Collected is money received.</h4>
            <p>
              Cash and manager-verified bank payments, by the date received. Split payments are
              counted individually.
            </p>
            <h4>Delivered value is care completed.</h4>
            <p>The snapshotted value of fulfilled visits. It can differ from collected payments.</p>
            <h4>Refunds remain in the story.</h4>
            <p>
              Refunds create reversing ledger entries. Original payments and receipts remain
              unchanged.
            </p>
            <div className="definition-fresh">
              <Clock size={14} />
              As of {time(new Date().toISOString())} · Asia/Karachi
            </div>
          </div>
        </section>
      </div>
      <div className="reports-grid">
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>The team, at a glance</h2>
              <p>Appointment value is shown for context, not a payroll statement.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Professional</th>
                  <th>Visits</th>
                  <th>Completed steps</th>
                  <th>Planned service value</th>
                </tr>
              </thead>
              <tbody>
                {s.professionals.map((p: any) => {
                  const b = scheduled.filter((b: any) =>
                    b.plan.steps.some((st: any) => st.professional_id === p.id),
                  );
                  const value = b.reduce(
                    (n: number, b: any) =>
                      n +
                      b.plan.service_ids.reduce((sum: number, sid: string) => {
                        const st = b.plan.steps.find(
                          (st: any) => st.service_id === sid && st.professional_id === p.id,
                        );
                        return sum + Number(st?.price_minor || 0);
                      }, 0),
                    0,
                  );
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="cell-client">
                          <Avatar name={p.name} color={p.data.color} />
                          <strong>{p.name}</strong>
                        </div>
                      </td>
                      <td>{b.length}</td>
                      <td>
                        {
                          s.steps.filter(
                            (st: any) =>
                              st.data.professional_id === p.id && st.state === 'COMPLETED',
                          ).length
                        }
                      </td>
                      <td>{currency(value)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card ai-report">
          <Sparkles size={30} strokeWidth={1.1} />
          <span className="eyebrow">A THOUGHTFUL SECOND LOOK</span>
          <h2>Your daily studio brief.</h2>
          <p>
            Ask Gemini for a grounded summary of today’s aggregate activity. No client records are
            shared.
          </p>
          {brief ? (
            <div className="brief-result">
              {brief.observations?.map((o: any, i: number) => (
                <div key={i}>
                  <strong>{o.statement}</strong>
                  <p>{o.suggested_action}</p>
                  <small>Sources: {o.metric_ids.join(', ')}</small>
                </div>
              ))}
              {brief.limitations?.map((l: string, i: number) => (
                <small key={i}>{l}</small>
              ))}
            </div>
          ) : (
            <button
              className="btn"
              disabled={busy || !['owner', 'manager'].includes(me.role)}
              onClick={async () => {
                setBusy(true);
                try {
                  const job = await post('/ai/operations-briefs');
                  const result = await awaitJob(job.id);
                  if (result.status !== 'completed')
                    throw new Error(result.result?.message || 'The assistant is unavailable.');
                  setBrief(result.result);
                } catch (e: any) {
                  notify(e.message, 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}Prepare
              my brief
            </button>
          )}
        </section>
      </div>
    </>
  );
}
