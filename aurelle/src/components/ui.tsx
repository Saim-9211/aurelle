import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Flower2, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { dayLabel, initials, shiftDate } from '../api';
import { useUI } from '../context';
export function IconButton({
  label,
  children,
  onClick,
  className = '',
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button className={`icon-btn ${className}`} aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

export function Avatar({
  name,
  color = 'sage',
  size = '',
}: {
  name: string;
  color?: string;
  size?: string;
}) {
  return <span className={`avatar ${color} ${size}`}>{initials(name)}</span>;
}

export function Badge({ status }: { status: string }) {
  const words: Record<string, string> = {
    CONFIRMED: 'Confirmed',
    HELD: 'On hold',
    FULFILLED: 'Completed',
    CANCELLED: 'Cancelled',
    EXPIRED: 'Expired',
    ACTIVE: 'In service',
    READY: 'Waiting',
    CALLED: 'Called',
    PLANNED: 'Upcoming',
    COMPLETED: 'Completed',
    TEMPORARILY_ABSENT: 'Away',
    CHECKOUT: 'Ready to pay',
    CLOSED: 'Paid',
  };
  return (
    <span className={`badge ${status.toLowerCase()}`}>
      <span />
      {words[status] || status}
    </span>
  );
}

export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Flower2 size={32} strokeWidth={1} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previous.current = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a,input,select,textarea,[tabindex="0"]',
          ) || [],
        );
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener('keydown', key);
      previous.current?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-heading">
          <div>
            <div className="eyebrow">A LITTLE ATTENTION TO DETAIL</div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function ErrorText({ error }: { error: string }) {
  return error ? (
    <div className="form-error" role="alert">
      <AlertCircle size={16} />
      {error}
    </div>
  ) : null;
}

export function DateNav() {
  const { date, setDate } = useUI();
  return (
    <div className="date-nav">
      <IconButton label="Previous day" onClick={() => setDate(shiftDate(date, -1))}>
        <ChevronLeft size={17} />
      </IconButton>
      <label className="date-label">
        <CalendarDays size={16} />
        <span>{dayLabel(date)}</span>
        <input
          aria-label="Select date"
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </label>
      <IconButton label="Next day" onClick={() => setDate(shiftDate(date, 1))}>
        <ChevronRight size={17} />
      </IconButton>
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
}

export function Metric({
  label,
  value,
  prefix,
  icon: Icon,
  foot,
  accent,
  trend,
}: {
  label: string;
  value: string;
  prefix?: string;
  icon: any;
  foot: string;
  accent: string;
  trend: string;
}) {
  return (
    <section className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <span className={`metric-icon ${accent}`}>
          <Icon size={19} strokeWidth={1.6} />
        </span>
      </div>
      <div className="metric-value">
        {prefix && <small>{prefix}</small>}
        {value}
      </div>
      <div className="metric-foot">
        <span>{foot}</span>
        <small>{trend}</small>
      </div>
    </section>
  );
}
