import {
  ArrowUpRight,
  Check,
  Clock,
  Flower2,
  Plus,
  Scissors,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { money, patch, post } from '../api';
import { ErrorText, Field, IconButton, Modal, PageHeading } from '../components/ui';
import { useUI } from '../context';
export function ServicesPage() {
  const { state: s, openBooking, notify, refresh, me } = useUI();
  const [category, setCategory] = useState('All'),
    [editing, setEditing] = useState<any>(null),
    [form, setForm] = useState({
      name: '',
      category: 'Hair',
      price: '',
      duration: 45,
      description: '',
      active: true,
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const canEdit = ['owner', 'manager'].includes(me.role);
  return (
    <>
      <PageHeading
        eyebrow="LITTLE RITUALS. LASTING IMPRESSIONS."
        title="Your signature kind of care."
        description="A considered collection of services, with the time and space each one deserves."
        actions={
          canEdit && (
            <button
              className="btn primary"
              onClick={() => {
                setEditing({ new: true });
                setForm({
                  name: '',
                  category: 'Hair',
                  price: '',
                  duration: 45,
                  description: '',
                  active: true,
                });
                setError('');
              }}
            >
              <Plus size={17} />
              Add service
            </button>
          )
        }
      />
      <div className="category-tabs large-tabs">
        {['All', 'Hair', 'Skin', 'Nails', 'Makeup'].map((c) => (
          <button
            key={c}
            className={category === c ? 'selected' : ''}
            onClick={() => setCategory(c)}
          >
            {c === 'All' ? 'All services' : c}
            <span>{s.services.filter((svc: any) => c === 'All' || svc.category === c).length}</span>
          </button>
        ))}
      </div>
      <div className="services-grid">
        {s.services
          .filter((svc: any) => category === 'All' || svc.category === category)
          .map((svc: any) => {
            const theme = { Hair: 'sage', Skin: 'lavender', Nails: 'peach', Makeup: 'sand' }[
              svc.category as 'Hair'
            ];
            return (
              <section
                key={svc.id}
                className={`card service-card ${!svc.active ? 'archived' : ''}`}
              >
                <div className="flex between">
                  <span className={`service-glyph ${theme}`}>
                    {svc.category === 'Hair' ? (
                      <Scissors size={24} strokeWidth={1.3} />
                    ) : svc.category === 'Nails' ? (
                      <Sparkles size={24} strokeWidth={1.3} />
                    ) : (
                      <Flower2 size={25} strokeWidth={1.3} />
                    )}
                  </span>
                  <span className="service-category">
                    {svc.category} · v{svc.version}
                    {!svc.active ? ' · Archived' : ''}
                  </span>
                </div>
                <h2>{svc.name}</h2>
                <p>{svc.data.description}</p>
                <div className="service-duration">
                  <Clock size={14} />
                  {svc.duration} min <span>·</span>
                  {svc.data.phases.length} phases incl. reset
                </div>
                <div className="service-phases">
                  {svc.data.phases.map((phase: any, i: number) => (
                    <div
                      key={i}
                      title={`${phase.name}: ${phase.minutes} min`}
                      style={{ flex: phase.minutes }}
                      className={phase.staff ? theme + '-bg' : 'processing-bg'}
                    />
                  ))}
                </div>
                <div className="service-card-bottom">
                  <strong>
                    <span>PKR</span>
                    {money(svc.price_minor)}
                  </strong>
                  <div className="flex gap">
                    {canEdit && (
                      <IconButton
                        label={`Edit ${svc.name}`}
                        onClick={() => {
                          setEditing(svc);
                          setForm({
                            name: svc.name,
                            category: svc.category,
                            price: String(Number(svc.price_minor) / 100),
                            duration: svc.duration,
                            description: svc.data.description,
                            active: svc.active,
                          });
                          setError('');
                        }}
                      >
                        <SlidersHorizontal size={17} />
                      </IconButton>
                    )}
                    <button
                      className="text-link"
                      disabled={!svc.active}
                      onClick={() => openBooking(false, [svc.id])}
                    >
                      Book
                      <ArrowUpRight size={17} />
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
      </div>
      {editing && (
        <Modal
          title={editing.new ? 'Something lovely to offer.' : 'A little refinement.'}
          subtitle="Prices and duration changes apply to new bookings. Confirmed visits keep their original details."
          onClose={() => setEditing(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                const data = {
                  name: form.name,
                  category: form.category,
                  price_minor: String(Math.round(Number(form.price) * 100)),
                  duration: form.duration,
                  description: form.description,
                  active: form.active,
                };
                if (editing.new) await post('/services', data);
                else await patch(`/services/${editing.id}`, data, editing.version);
                notify('Service published. Confirmed appointments keep their snapshots.');
                refresh();
                setEditing(null);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Service name">
              <input
                required
                minLength={2}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            {editing.new && (
              <Field label="Category">
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {['Hair', 'Skin', 'Nails', 'Makeup'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
            )}
            <div className="field-pair">
              <Field label="Price (PKR)">
                <input
                  type="number"
                  min="0"
                  max="9999999"
                  step="1"
                  required
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </Field>
              <Field label="Duration incl. reset (minutes)">
                <input
                  type="number"
                  min="10"
                  max="480"
                  required
                  disabled={!editing.new && editing.data.phases.length > 2}
                  value={form.duration}
                  onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })}
                />
              </Field>
            </div>
            {editing.new ? (
              <Field label="Description">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                />
              </Field>
            ) : (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                <span>Available for new appointments</span>
              </label>
            )}
            <ErrorText error={error} />
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                Publish service
                <Check size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
