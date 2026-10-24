import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Check,
  Heart,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import React, { useState } from 'react';
import { api, dayLabel, patch, post } from '../api';
import { Avatar, Badge, Empty, ErrorText, Field, Modal, PageHeading } from '../components/ui';
import { useUI } from '../context';
export function ClientsPage() {
  const { state: s, notify, refresh } = useUI();
  const [search, setSearch] = useState(''),
    [adding, setAdding] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [name, setName] = useState(''),
    [phone, setPhone] = useState(''),
    [email, setEmail] = useState(''),
    [preferences, setPreferences] = useState(''),
    [marketing, setMarketing] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const clients = s.customers.filter((c: any) =>
    `${c.name} ${c.phone}`.toLowerCase().includes(search.toLowerCase()),
  );
  const profileBookings = useQuery({
    queryKey: ['client-history', selected?.id],
    queryFn: () => api('/bookings'),
    enabled: !!selected,
  });
  function edit(c: any) {
    setSelected(c);
    setName(c.name);
    setPreferences(c.data.preferences || '');
    setMarketing(c.data.marketing || false);
    setError('');
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (selected)
        await patch(
          `/customers/${selected.id}`,
          { name, preferences, marketing },
          selected.version,
        );
      else await post('/customers', { name, phone, email, marketing });
      notify(selected ? 'Client preferences saved.' : 'A new client, warmly welcomed.');
      setAdding(false);
      setSelected(null);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="THE PEOPLE AT THE HEART OF YOUR STUDIO"
        title="Familiar faces. Thoughtful care."
        description="Keep the details that make every visit feel personal."
        actions={
          <button
            className="btn primary"
            onClick={() => {
              setAdding(true);
              setName('');
              setPhone('');
              setEmail('');
              setMarketing(false);
              setError('');
            }}
          >
            <Plus size={17} />
            Add client
          </button>
        }
      />
      <div className="mini-stat-row">
        <span>
          <Users size={19} />
          <strong>{s.customers.length}</strong>clients in your studio
        </span>
        <span>
          <Heart size={19} />
          <strong>{s.customers.filter((c: any) => c.data.tags?.includes('Regular')).length}</strong>
          regulars, warmly welcomed
        </span>
        <span>
          <ShieldCheck size={19} />
          Preferences belong to this business.
        </span>
      </div>
      <section className="card">
        <div className="card-heading">
          <h2>Your little community</h2>
          <div className="input-search">
            <Search size={16} />
            <input
              placeholder="Find a name or number…"
              aria-label="Search clients"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Contact</th>
                <th>Relationship</th>
                <th>Communication</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clients.map((c: any, i: number) => (
                <tr
                  key={c.id}
                  onClick={() => edit(c)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && edit(c)}
                >
                  <td>
                    <div className="cell-client">
                      <Avatar name={c.name} color={['sage', 'peach', 'lavender', 'sand'][i % 4]} />
                      <div>
                        <strong>{c.name}</strong>
                        <small>{c.data.email || 'A little care, just for them'}</small>
                      </div>
                    </div>
                  </td>
                  <td className="phone-text">{c.phone}</td>
                  <td>
                    <span className={`tag ${c.data.tags?.includes('Regular') ? 'sage' : ''}`}>
                      {c.data.tags?.includes('Regular') ? 'Regular' : 'Client'}
                    </span>
                  </td>
                  <td>{c.data.marketing ? 'Marketing opted in' : 'Service updates only'}</td>
                  <td>
                    {new Date(c.created_at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td>
                    <ArrowUpRight size={16} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!clients.length && (
          <Empty
            title="No familiar face just yet"
            description="Try another name or add a new client."
          />
        )}
      </section>
      {(adding || selected) && (
        <Modal
          title={selected ? 'The details that matter.' : 'A new face. A warm welcome.'}
          subtitle={
            selected
              ? `${selected.phone} · Client preferences for this studio`
              : 'A simple profile is all you need to get started.'
          }
          onClose={() => {
            setAdding(false);
            setSelected(null);
          }}
        >
          <form onSubmit={save}>
            <Field label="Full name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                required
              />
            </Field>
            {!selected && (
              <>
                <Field label="Mobile number">
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0300 1234567"
                    required
                  />
                </Field>
                <Field label="Email (optional)">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
              </>
            )}
            {selected && (
              <>
                <Field
                  label="Service preferences"
                  hint="Keep notes about style and preferences. Do not enter medical or sensitive personal information."
                >
                  <textarea
                    value={preferences}
                    onChange={(e) => setPreferences(e.target.value)}
                    rows={4}
                    maxLength={1000}
                  />
                </Field>
                <h4>Visit history</h4>
                <div className="client-history">
                  {profileBookings.data
                    ?.filter((b: any) => b.customer_id === selected.id)
                    .slice(0, 8)
                    .map((b: any) => (
                      <div key={b.id}>
                        <div>
                          <strong>{b.plan.steps[0]?.service_name}</strong>
                          <small>
                            {dayLabel(new Date(b.starts_at).toISOString().slice(0, 10))}
                          </small>
                        </div>
                        <Badge status={b.status} />
                      </div>
                    ))}
                  {profileBookings.isPending && <p className="muted">Loading visit history…</p>}
                </div>
              </>
            )}
            <label className="check-label">
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
              />
              <span>
                Client has explicitly agreed to marketing messages. This is optional and separate
                from service communication.
              </span>
            </label>
            <ErrorText error={error} />
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setAdding(false);
                  setSelected(null);
                }}
              >
                Cancel
              </button>
              <button className="btn primary" disabled={busy} type="submit">
                {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Save
                client
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
