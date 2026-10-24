import { ArrowRight, ChevronDown, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { dateNow, minutes, time } from '../api';
import { Avatar } from '../components/ui';
import { useUI } from '../context';
export function Schedule({ compact = false }: { compact?: boolean }) {
  const { state: s, openDetail, date } = useUI();
  const [filter, setFilter] = useState('all');
  const hours = compact ? [10, 11, 12, 13, 14, 15] : [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  const bookings = s.bookings.filter(
    (b: any) => !['CANCELLED', 'EXPIRED', 'HELD'].includes(b.status),
  );
  const pros = s.professionals.filter((p: any) => filter === 'all' || p.id === filter);
  const unit = compact ? 72 : 90;
  const today = date === dateNow();
  const nowMinutes = minutes(new Date().toISOString());
  return (
    <>
      <div className="schedule-toolbar">
        <div className="legend">
          <span>
            <i className="dot sage-bg" />
            Hair
          </span>
          <span>
            <i className="dot peach-bg" />
            Nails
          </span>
          <span>
            <i className="dot lavender-bg" />
            Skin & makeup
          </span>
        </div>
        <label className="select-min">
          <Users size={14} />
          <select
            aria-label="Filter by team member"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All team members</option>
            {s.professionals.map((p: any) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown size={12} />
        </label>
      </div>
      <div className="schedule-scroll">
        <div className="schedule-grid" style={{ minWidth: compact ? 600 : 650 }}>
          <div
            className="schedule-head"
            style={{ gridTemplateColumns: `55px repeat(${pros.length}, minmax(120px,1fr))` }}
          >
            <span className="timezone-label">PKT</span>
            {pros.map((p: any) => (
              <div key={p.id}>
                <Avatar name={p.name} color={p.data.color} size="small" />
                <div>
                  <strong>{p.name.split(' ')[0]}</strong>
                  <small>{p.title.split(' ').slice(0, 2).join(' ')}</small>
                </div>
              </div>
            ))}
          </div>
          <div
            className="schedule-body"
            style={{
              height: hours.length * unit,
              gridTemplateColumns: `55px repeat(${pros.length}, minmax(120px,1fr))`,
            }}
          >
            <div className="time-axis">
              {hours.map((h) => (
                <span key={h} style={{ top: (h - 10) * unit }}>
                  {h > 12 ? h - 12 : h}
                  <small>{h >= 12 ? 'pm' : 'am'}</small>
                </span>
              ))}
            </div>
            {pros.map((p: any) => (
              <div
                className="schedule-column"
                key={p.id}
                style={{ backgroundSize: `100% ${unit}px` }}
              >
                {bookings
                  .filter((b: any) => b.plan.steps.some((st: any) => st.professional_id === p.id))
                  .map((b: any) => {
                    const st = b.plan.steps.filter((st: any) => st.professional_id === p.id),
                      start = Math.max(minutes(st[0].starts_at), 600),
                      end = minutes(st.at(-1).ends_at);
                    if (start >= hours.at(-1)! * 60 + 60 || end <= 600) return null;
                    const height = Math.max(
                      35,
                      ((Math.min(end, (hours.at(-1)! + 1) * 60) - start) / 60) * unit - 5,
                    );
                    return (
                      <button
                        key={b.id}
                        className={`appointment-block ${st[0].category === 'Hair' ? 'sage' : st[0].category === 'Nails' ? 'peach' : 'lavender'}`}
                        style={{ top: ((start - 600) / 60) * unit + 3, height }}
                        onClick={() => openDetail(b)}
                      >
                        <strong>{b.customer_name}</strong>
                        <span>{st[0].service_name}</span>
                        {height > 54 && (
                          <small>
                            {time(b.starts_at)} <span>·</span>{' '}
                            {Math.round((+new Date(b.ends_at) - +new Date(b.starts_at)) / 60000)}{' '}
                            min
                          </small>
                        )}
                        {b.source === 'walk_in' && height > 75 && <em>Walk-in</em>}
                      </button>
                    );
                  })}
              </div>
            ))}
            {today && nowMinutes >= 600 && nowMinutes < (hours.at(-1)! + 1) * 60 && (
              <div className="now-line" style={{ top: ((nowMinutes - 600) / 60) * unit }}>
                <span />
                {time(new Date().toISOString())}
              </div>
            )}
          </div>
        </div>
      </div>
      {compact && (
        <Link to="/calendar" className="card-bottom-link">
          See the full day <ArrowRight size={15} />
        </Link>
      )}
    </>
  );
}
