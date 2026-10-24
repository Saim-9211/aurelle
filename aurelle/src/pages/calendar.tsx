import { ArrowUpRight, CalendarDays, NotebookPen, Plus } from 'lucide-react';
import { useState } from 'react';
import { currency, time } from '../api';
import { Schedule } from '../components/schedule';
import { Avatar, Badge, DateNav, Empty, PageHeading } from '../components/ui';
import { useUI } from '../context';
export function CalendarPage() {
  const { state: s, openBooking, openDetail } = useUI();
  const [view, setView] = useState('calendar');
  const [status, setStatus] = useState('all');
  return (
    <>
      <PageHeading
        eyebrow="EVERY VISIT, THOUGHTFULLY PLANNED"
        title="Make room for a beautiful day."
        description="Your appointments, your team, and all the little details in between."
        actions={
          <button className="btn primary" onClick={() => openBooking()}>
            <Plus size={18} />
            New appointment
          </button>
        }
      />
      <section className="card">
        <div className="card-heading">
          <div className="flex gap">
            <DateNav />
            <span className="timezone-note">Asia/Karachi</span>
          </div>
          <div className="segmented">
            <button
              className={view === 'calendar' ? 'selected' : ''}
              onClick={() => setView('calendar')}
            >
              <CalendarDays size={15} />
              Day calendar
            </button>
            <button className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}>
              <NotebookPen size={15} />
              List
            </button>
          </div>
        </div>
        {view === 'calendar' ? (
          <Schedule />
        ) : (
          <>
            <div className="list-toolbar">
              <span>{s.bookings.length} appointments</span>
              <select
                aria-label="Filter appointments by status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All statuses</option>
                {['CONFIRMED', 'FULFILLED', 'CANCELLED', 'HELD', 'EXPIRED'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Service</th>
                    <th>Time</th>
                    <th>Professional</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {s.bookings
                    .filter((b: any) => status === 'all' || b.status === status)
                    .map((b: any) => (
                      <tr
                        key={b.id}
                        onClick={() => openDetail(b)}
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && openDetail(b)}
                      >
                        <td>
                          <div className="cell-client">
                            <Avatar name={b.customer_name} />
                            <div>
                              <strong>{b.customer_name}</strong>
                              <small>{b.reference}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          {b.plan.steps[0]?.service_name}
                          {b.plan.service_ids.length > 1 && ` +${b.plan.service_ids.length - 1}`}
                        </td>
                        <td>{time(b.starts_at)}</td>
                        <td>{b.plan.steps[0]?.professional_name}</td>
                        <td>{currency(b.total_minor)}</td>
                        <td>
                          <Badge status={b.status} />
                        </td>
                        <td>
                          <ArrowUpRight size={16} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!s.bookings.length && (
              <Empty
                title="A fresh page in your day"
                description="Add an appointment or welcome a walk-in to get started."
              />
            )}
          </>
        )}
      </section>
    </>
  );
}
