import { AlertCircle, ArrowRight, LoaderCircle, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { currency, post, time } from '../api';
import { ErrorText, Field, Modal } from '../components/ui';
import { useUI } from '../context';
import { awaitJob } from '../utils';
export function AssistantDrawer({
  configured,
  onClose,
}: {
  configured: boolean;
  onClose: () => void;
}) {
  const { notify, openBooking } = useUI();
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState('');
  return (
    <Modal
      title="A little help finding the flow."
      subtitle="Your staff booking assistant · Powered by Gemini"
      onClose={onClose}
    >
      <div className="assistant-intro">
        <span className="assistant-flower">
          <Sparkles size={25} strokeWidth={1.2} />
        </span>
        <p>
          English, Urdu, or Roman Urdu. Tell me what the visit needs, and I’ll help turn it into a
          thoughtful plan.
        </p>
      </div>
      {!configured && (
        <div className="notice warm">
          <AlertCircle size={20} />
          <div>
            <strong>Gemini is not connected yet.</strong>
            <p>
              Set GEMINI_API_KEY on the server to enable live assistance. The regular booking form
              is ready to use.
            </p>
          </div>
        </div>
      )}
      <div className="prompt-suggestions">
        {[
          'Tomorrow after 5, a haircut and manicure under PKR 4,000',
          'Kal shaam 5 ke baad haircut aur manicure, 4000 ke andar',
        ].map((prompt) => (
          <button key={prompt} onClick={() => setText(prompt)}>
            <Sparkles size={13} />
            {prompt}
          </button>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setResult(null);
          try {
            const job = await post('/ai/booking-drafts', { text });
            const response = await awaitJob(job.id);
            if (response.status !== 'completed')
              throw new Error(response.result?.message || 'The assistant is unavailable.');
            setResult(response.result);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field
          label="What would you like to arrange?"
          hint="Keep names, contact details, and sensitive notes out of your request."
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="A haircut and manicure tomorrow afternoon…"
            dir="auto"
          />
        </Field>
        <ErrorText error={error} />
        <button
          className="btn primary full"
          disabled={!configured || busy || text.length < 5}
          type="submit"
        >
          {busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}{' '}
          {busy ? 'Finding a thoughtful plan…' : 'Help me plan this visit'}
        </button>
      </form>
      {result && (
        <div className="assistant-result">
          <span className="eyebrow">A DRAFT FOR YOU TO REVIEW</span>
          <h3>{result.status === 'ready' ? 'A little clarity.' : 'One little question.'}</h3>
          <p>{result.explanation}</p>
          {result.clarifying_questions?.map((q: string, i: number) => (
            <p key={i}>{q}</p>
          ))}
          {result.quotes?.map((q: any) => (
            <div className="summary-line" key={q.quote_id}>
              <span>
                {time(q.starts_at)} — {time(q.ends_at)}
              </span>
              <strong>{currency(q.total_minor)}</strong>
            </div>
          ))}
          {result.service_variant_ids?.length > 0 && (
            <button
              className="btn primary full"
              onClick={() => {
                onClose();
                openBooking(false, result.service_variant_ids);
              }}
            >
              Review in booking form
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      )}
      <div className="form-note">
        <ShieldCheck size={16} />
        Drafts need staff review. The assistant cannot confirm bookings, take payments, or send
        messages.
      </div>
      <button
        className="text-link"
        onClick={() => {
          onClose();
          openBooking();
        }}
      >
        Use the regular booking form
        <ArrowRight size={15} />
      </button>
    </Modal>
  );
}
