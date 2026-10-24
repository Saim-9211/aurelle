import { Check, LoaderCircle, Plus } from 'lucide-react';
import { useState } from 'react';
import { post } from '../api';
import { ErrorText, Field, Modal } from '../components/ui';
import { useUI } from '../context';
export function CreateStudioItem({
  kind,
  onClose,
}: {
  kind: 'professional' | 'product' | 'resource';
  onClose: () => void;
}) {
  const { notify, refresh } = useUI();
  const [form, setForm] = useState({
      name: '',
      title: '',
      skills: ['Hair'],
      start: '10:00',
      end: '20:00',
      category: 'Hair care',
      unit: 'bottles',
      on_hand: 0,
      reorder_at: 5,
      price: 0,
      resource_type: 'chair',
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title={
        kind === 'professional'
          ? 'Good hands. A warm welcome.'
          : kind === 'resource'
            ? 'A little more room for care.'
            : 'Something for your studio shelf.'
      }
      subtitle={
        kind === 'professional'
          ? 'Add qualifications and working hours. Workforce sign-in is provisioned separately through controlled onboarding.'
          : kind === 'resource'
            ? 'Each chair, room, or nail station is reserved as a concrete unit.'
            : 'Opening stock is recorded as an auditable movement.'
      }
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            if (kind === 'professional')
              await post('/professionals', {
                name: form.name,
                title: form.title,
                skills: form.skills,
                start: form.start,
                end: form.end,
              });
            else if (kind === 'resource')
              await post('/resources', { name: form.name, resource_type: form.resource_type });
            else
              await post('/products', {
                name: form.name,
                category: form.category,
                unit: form.unit,
                on_hand: form.on_hand,
                reorder_at: form.reorder_at,
                price_minor: String(Math.round(form.price * 100)),
              });
            notify('Your studio has a little more room to grow.');
            refresh();
            onClose();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field
          label={
            kind === 'professional'
              ? 'Full name'
              : kind === 'resource'
                ? 'Station name'
                : 'Product name'
          }
        >
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            minLength={2}
            maxLength={100}
            required
          />
        </Field>
        {kind === 'professional' ? (
          <>
            <Field label="Professional title">
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                minLength={2}
                required
                placeholder="Senior stylist, nail specialist…"
              />
            </Field>
            <Field label="Qualified categories">
              <div className="day-picker">
                {['Hair', 'Skin', 'Nails', 'Makeup'].map((skill) => (
                  <button
                    type="button"
                    key={skill}
                    className={form.skills.includes(skill) ? 'selected' : ''}
                    onClick={() =>
                      setForm({
                        ...form,
                        skills: form.skills.includes(skill)
                          ? form.skills.filter((s) => s !== skill)
                          : [...form.skills, skill],
                      })
                    }
                  >
                    {form.skills.includes(skill) && <Check size={12} />} {skill}
                  </button>
                ))}
              </div>
            </Field>
            <div className="field-pair">
              <Field label="Shift starts">
                <input
                  type="time"
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                  required
                />
              </Field>
              <Field label="Shift ends">
                <input
                  type="time"
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                  required
                />
              </Field>
            </div>
          </>
        ) : kind === 'resource' ? (
          <Field label="Station type">
            <select
              value={form.resource_type}
              onChange={(e) => setForm({ ...form, resource_type: e.target.value })}
            >
              <option value="chair">Styling chair</option>
              <option value="room">Private treatment room</option>
              <option value="nail">Nail station</option>
            </select>
          </Field>
        ) : (
          <>
            <div className="field-pair">
              <Field label="Category">
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  required
                />
              </Field>
              <Field label="Unit">
                <input
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  required
                  placeholder="bottles, packs, jars…"
                />
              </Field>
            </div>
            <div className="field-pair">
              <Field label="Opening quantity">
                <input
                  type="number"
                  min="0"
                  max="100000"
                  value={form.on_hand}
                  onChange={(e) => setForm({ ...form, on_hand: Number(e.target.value) })}
                  required
                />
              </Field>
              <Field label="Reorder threshold">
                <input
                  type="number"
                  min="0"
                  max="100000"
                  value={form.reorder_at}
                  onChange={(e) => setForm({ ...form, reorder_at: Number(e.target.value) })}
                  required
                />
              </Field>
            </div>
            <Field label="Unit value (PKR)">
              <input
                type="number"
                min="0"
                max="99999999"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
                required
              />
            </Field>
          </>
        )}
        <ErrorText error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={busy || (kind === 'professional' && !form.skills.length)}
          >
            {busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}Add{' '}
            {kind === 'resource' ? 'station' : kind}
          </button>
        </div>
      </form>
    </Modal>
  );
}
