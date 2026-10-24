import {
  ArrowRight,
  ArrowUpRight,
  Clock,
  Flower2,
  LoaderCircle,
  Monitor,
  Plus,
  Radio,
  ScanLine,
  Scissors,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { post, time } from '../api';
import { Avatar, Field, Modal, PageHeading } from '../components/ui';
import { useUI } from '../context';
export function QueuePage() {
  const { state: s, openBooking, openDetail, notify, refresh } = useUI();
  const [scanning, setScanning] = useState(false),
    [pass, setPass] = useState(''),
    [busy, setBusy] = useState(false);
  const columns = [
    { name: 'Expected', hint: 'A warm welcome, coming up', state: 'expected' },
    { name: 'Waiting', hint: 'Checked in and in good hands', state: 'waiting' },
    { name: 'In service', hint: 'A little time for themselves', state: 'active' },
    { name: 'Checkout', hint: 'Finish on a lovely note', state: 'checkout' },
  ];
  const bookingsFor = (state: string) =>
    s.bookings.filter(
      (b: any) =>
        (b.status === 'CONFIRMED' && !b.arrived_at && state === 'expected') ||
        (b.visit_status === 'WAITING' && state === 'waiting') ||
        (b.visit_status === 'IN_SERVICE' && state === 'active') ||
        (b.visit_status === 'CHECKOUT' && state === 'checkout'),
    );
  async function callNext() {
    setBusy(true);
    try {
      await post('/dispatch/call-next');
      notify('The next eligible client has been called.');
      refresh();
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="KEEP THE GOOD FLOW GOING"
        title="Every client, cared for."
        description="From the first hello to the finishing touch. Your studio floor, live."
        actions={
          <>
            <Link to="/display" className="btn">
              <Monitor size={17} />
              Display
            </Link>
            <button className="btn" onClick={() => setScanning(true)}>
              <ScanLine size={17} />
              Verify pass
            </button>
            <button className="btn primary" onClick={() => openBooking(true)}>
              <Plus size={17} />
              Add walk-in
            </button>
          </>
        }
      />
      <div className="queue-status-bar">
        <span className="live-label">
          <span /> LIVE OPERATIONS
        </span>
        <span>Checked-in clients move through each service in sequence.</span>
        <button className="text-link" onClick={callNext} disabled={busy}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <Radio size={16} />}Call next client{' '}
          <ArrowRight size={16} />
        </button>
      </div>
      <div className="queue-board">
        {columns.map((column, ci) => {
          const list = bookingsFor(column.state);
          return (
            <section className="queue-column" key={column.state}>
              <div className="queue-column-title">
                <div>
                  <h3>
                    <span
                      className={`queue-dot ${['sand-bg', 'peach-bg', 'sage-bg', 'lavender-bg'][ci]}`}
                    />
                    {column.name}
                    <span>{list.length}</span>
                  </h3>
                  <p>{column.hint}</p>
                </div>
              </div>
              {list.map((b: any) => {
                const st = s.steps.find(
                  (st: any) =>
                    st.booking_id === b.id && ['ACTIVE', 'READY', 'CALLED'].includes(st.state),
                );
                return (
                  <button className="queue-client-card" key={b.id} onClick={() => openDetail(b)}>
                    <div className="flex between">
                      <Avatar
                        name={b.customer_name}
                        color={['sand', 'peach', 'sage', 'lavender'][ci]}
                      />
                      <span className="queue-time">{time(b.starts_at)}</span>
                    </div>
                    <h3>{b.customer_name}</h3>
                    <p>{st?.data.phase || b.plan.steps[0]?.service_name}</p>
                    <div className="queue-professional">
                      <Scissors size={13} />
                      {st?.data.professional_name || b.plan.steps[0]?.professional_name}
                    </div>
                    <div className="queue-card-bottom">
                      <span>{b.reference.slice(-8)}</span>
                      <span>
                        {column.state === 'expected'
                          ? 'Check in'
                          : column.state === 'checkout'
                            ? 'Take payment'
                            : 'View service'}
                        <ArrowUpRight size={14} />
                      </span>
                    </div>
                    {st?.delay_minutes > 0 && (
                      <small className="delay-tag">
                        <Clock size={12} />
                        Delayed {st.delay_minutes} min
                      </small>
                    )}
                  </button>
                );
              })}
              {!list.length && (
                <div className="queue-empty">
                  <Flower2 size={25} strokeWidth={1} />
                  <span>A little breathing room.</span>
                </div>
              )}
            </section>
          );
        })}
      </div>
      {scanning && (
        <Modal
          title="A warm welcome awaits."
          subtitle="Paste the full visit pass content from a scanner, or check in manually from an appointment."
          onClose={() => setScanning(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await post('/arrivals/scan', { payload: pass });
                notify('Visit pass verified. Client checked in.');
                refresh();
                setScanning(false);
              } catch (e: any) {
                notify(e.message, 'error');
              }
            }}
          >
            <Field label="Visit pass content">
              <textarea
                autoFocus
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                required
                rows={4}
                placeholder="aurelle:v1:…"
              />
            </Field>
            <div className="form-note">
              <ShieldCheck size={17} />
              Old, cancelled, and rescheduled passes are automatically rejected.
            </div>
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setScanning(false)}>
                Cancel
              </button>
              <button className="btn primary" type="submit">
                Verify & check in
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
