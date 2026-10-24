import { AlertCircle, Check, CheckCheck, Package, Plus } from 'lucide-react';
import { useState } from 'react';
import { currency, post } from '../api';
import { ErrorText, Field, Metric, Modal, PageHeading } from '../components/ui';
import { useUI } from '../context';
import { CreateStudioItem } from '../features/studio-setup';
export function InventoryPage() {
  const { state: s, notify, refresh } = useUI();
  const [creating, setCreating] = useState<'product' | 'resource' | null>(null);
  const [filter, setFilter] = useState('all'),
    [selected, setSelected] = useState<any>(null),
    [delta, setDelta] = useState(1),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const low = s.products.filter((p: any) => p.on_hand <= p.reorder_at);
  return (
    <>
      <PageHeading
        eyebrow="READY FOR THE NEXT LITTLE RITUAL"
        title="The essentials, in good supply."
        description="Keep your shelves considered, your stock accurate, and your team prepared."
        actions={
          <>
            <button className="btn" onClick={() => setCreating('resource')}>
              <Plus size={17} />
              Add station
            </button>
            <button className="btn primary" onClick={() => setCreating('product')}>
              <Plus size={17} />
              Add product
            </button>
          </>
        }
      />
      {creating && <CreateStudioItem kind={creating} onClose={() => setCreating(null)} />}
      <div className="metrics-grid inventory-metrics">
        <Metric
          label="Products tracked"
          value={String(s.products.length).padStart(2, '0')}
          icon={Package}
          accent="sage"
          foot="Studio & retail essentials"
          trend="Unit-level counts"
        />
        <Metric
          label="A little attention needed"
          value={String(low.length).padStart(2, '0')}
          icon={AlertCircle}
          accent="peach"
          foot="At or below reorder level"
          trend="Time to replenish"
        />
        <Metric
          label="Stock on hand"
          value={String(s.products.reduce((n: number, p: any) => n + p.on_hand, 0))}
          icon={CheckCheck}
          accent="lavender"
          foot="Across all tracked products"
          trend="Audited adjustments"
        />
      </div>
      {low.length > 0 && (
        <div className="notice warm">
          <Package size={22} />
          <div>
            <strong>A little restock goes a long way.</strong>
            <p>
              {low.map((p: any) => p.name).join(' and ')} {low.length === 1 ? 'is' : 'are'} ready
              for replenishment.
            </p>
          </div>
        </div>
      )}
      <section className="card">
        <div className="card-heading">
          <h2>Your studio shelf</h2>
          <div className="segmented">
            <button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>
              All products
            </button>
            <button className={filter === 'low' ? 'selected' : ''} onClick={() => setFilter('low')}>
              Low stock ({low.length})
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>On hand</th>
                <th>Reorder at</th>
                <th>Unit value</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.products
                .filter((p: any) => filter === 'all' || p.on_hand <= p.reorder_at)
                .map((p: any) => (
                  <tr key={p.id}>
                    <td>
                      <div className="cell-client">
                        <span className="product-glyph">
                          <Package size={19} strokeWidth={1.4} />
                        </span>
                        <div>
                          <strong>{p.name}</strong>
                          <small>{p.unit}</small>
                        </div>
                      </div>
                    </td>
                    <td>{p.category}</td>
                    <td>
                      <strong>{p.on_hand}</strong> {p.unit}
                    </td>
                    <td>{p.reorder_at}</td>
                    <td>{currency(p.price_minor)}</td>
                    <td>
                      <span className={`tag ${p.on_hand <= p.reorder_at ? 'peach' : 'sage'}`}>
                        {p.on_hand <= p.reorder_at ? 'Restock soon' : 'In good supply'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn small"
                        onClick={() => {
                          setSelected(p);
                          setDelta(1);
                          setReason('');
                          setError('');
                        }}
                      >
                        Adjust
                        <Plus size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" style={{ marginTop: 24 }}>
        <div className="card-heading">
          <div>
            <h2>Room for thoughtful care</h2>
            <p>Each station is a concrete unit in the booking calendar.</p>
          </div>
          <span className="tag sage">{s.resources?.length || 0} stations</span>
        </div>
        <div
          className="mini-stat-row"
          style={{ margin: 0, border: 0, borderTop: '1px solid var(--border)', borderRadius: 0 }}
        >
          {s.resources?.map((r: any) => (
            <span key={r.id}>
              <Package size={17} />
              <strong style={{ fontSize: 12 }}>{r.name}</strong>
              <small>{r.resource_type}</small>
            </span>
          ))}
        </div>
      </section>
      {selected && (
        <Modal
          title="Keep the little details accurate."
          subtitle={`${selected.name} · ${selected.on_hand} ${selected.unit} on hand`}
          onClose={() => setSelected(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await post(
                  '/stock-adjustments',
                  { product_id: selected.id, delta, reason },
                  selected.version,
                );
                notify('Stock updated and the movement recorded.');
                refresh();
                setSelected(null);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field
              label={`Adjustment (${selected.unit})`}
              hint="Use a positive number for stock received, or a negative number for usage, damage, or a count correction."
            >
              <input
                type="number"
                value={delta}
                min={-selected.on_hand}
                max={10000}
                onChange={(e) => setDelta(Number(e.target.value))}
                required
              />
            </Field>
            <Field label="Reason">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                minLength={3}
                placeholder="Supplier delivery, service usage, count correction…"
                required
              />
            </Field>
            <div className="review-total">
              <span>New balance</span>
              <strong>
                {selected.on_hand + delta} {selected.unit}
              </strong>
            </div>
            <ErrorText error={error} />
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setSelected(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={busy || delta === 0}>
                Record adjustment
                <Check size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
