import { CalendarDays, Check, Clock, Flower2, Leaf, Plus, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { patch, time } from '../api';
import { Avatar, ErrorText, Field, Modal, PageHeading } from '../components/ui';
import { useUI } from '../context';
import { CreateStudioItem } from '../features/studio-setup';
export function TeamPage() {
  const { state: s, notify, refresh } = useUI();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<any>(null),
    [start, setStart] = useState('10:00'),
    [end, setEnd] = useState('20:00'),
    [offDays, setOffDays] = useState<number[]>([]),
    [ack, setAck] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <>
      <PageHeading
        eyebrow="THE HANDS BEHIND EVERY BEAUTIFUL VISIT"
        title="Good people. Great care."
        description="A thoughtful view of your team, their specialities, and their day."
        actions={
          <>
            <Link className="btn" to="/calendar">
              <CalendarDays size={17} />
              Team calendar
            </Link>
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={17} />
              Add professional
            </button>
          </>
        }
      />
      <div className="team-grid">
        {creating && <CreateStudioItem kind="professional" onClose={() => setCreating(false)} />}
        {s.professionals.map((p: any) => {
          const active = s.steps.some(
            (st: any) => st.data.professional_id === p.id && st.state === 'ACTIVE',
          );
          const count = s.bookings.filter(
            (b: any) =>
              b.status !== 'CANCELLED' &&
              b.plan.steps.some((st: any) => st.professional_id === p.id),
          ).length;
          return (
            <section key={p.id} className="card team-card">
              <div className={`team-cover ${p.data.color}`}>
                <Flower2 size={93} strokeWidth={0.5} />
                <span className={`availability-label ${active ? 'in-service' : ''}`}>
                  <span />
                  {active ? 'In service' : 'Between services'}
                </span>
              </div>
              <Avatar name={p.name} color={p.data.color} size="xl" />
              <div className="team-card-body">
                <h2>{p.name}</h2>
                <p>{p.title}</p>
                <div className="flex gap center">
                  {p.data.skills.map((skill: string) => (
                    <span className="tag" key={skill}>
                      {skill}
                    </span>
                  ))}
                </div>
                <div className="team-numbers">
                  <div>
                    <strong>{count}</strong>
                    <span>Appointments today</span>
                  </div>
                  <div>
                    <strong>
                      {p.data.start}–{p.data.end}
                    </strong>
                    <span>Working hours · PKT</span>
                  </div>
                </div>
                <div className="team-break">
                  <Clock size={14} />
                  Daily break:{' '}
                  {p.data.breaks?.map((b: any) => `${b.start}–${b.end}`).join(', ') || 'None'}
                </div>
                <button
                  className="btn full"
                  onClick={() => {
                    setSelected(p);
                    setStart(p.data.start);
                    setEnd(p.data.end);
                    setOffDays(p.data.off_days || []);
                    setAck(false);
                    setError('');
                  }}
                >
                  <SlidersHorizontal size={15} />
                  Manage availability
                </button>
              </div>
            </section>
          );
        })}
      </div>
      <div className="notice">
        <Leaf size={22} />
        <div>
          <strong>A balanced team makes a beautiful studio.</strong>
          <p>
            Professional qualifications, shifts, breaks, and reserved stations all inform real
            availability.
          </p>
        </div>
      </div>
      {selected && (
        <Modal
          title={`A little balance for ${selected.name.split(' ')[0]}.`}
          subtitle="Availability changes preserve confirmed appointments and record their impact."
          onClose={() => setSelected(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                const result = await patch(
                  `/professionals/${selected.id}`,
                  { start, end, off_days: offDays, acknowledged_impacts: ack },
                  selected.version,
                );
                notify(
                  `Availability saved. ${result.impacted.length} existing appointments flagged for review.`,
                );
                refresh();
                setSelected(null);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="field-pair">
              <Field label="Shift starts">
                <input
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  required
                />
              </Field>
              <Field label="Shift ends">
                <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
              </Field>
            </div>
            <Field label="Weekly days off">
              <div className="day-picker">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                  <button
                    type="button"
                    key={d}
                    className={offDays.includes(i) ? 'selected' : ''}
                    onClick={() =>
                      setOffDays(
                        offDays.includes(i) ? offDays.filter((x) => x !== i) : [...offDays, i],
                      )
                    }
                  >
                    {d}
                  </button>
                ))}
              </div>
            </Field>
            <div className="impact-list">
              <strong>Upcoming appointments to review</strong>
              {s.bookings
                .filter(
                  (b: any) =>
                    b.status === 'CONFIRMED' &&
                    b.plan.steps.some((st: any) => st.professional_id === selected.id),
                )
                .map((b: any) => (
                  <div key={b.id}>
                    <span>
                      {b.customer_name} · {time(b.starts_at)}
                    </span>
                    <small>{b.reference}</small>
                  </div>
                ))}
            </div>
            <label className="check-label">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>
                I will review all affected future appointments and arrange changes with clients.
                Existing reservations remain in place.
              </span>
            </label>
            <ErrorText error={error} />
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setSelected(null)}>
                Cancel
              </button>
              <button className="btn primary" type="submit" disabled={busy}>
                Save availability
                <Check size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
