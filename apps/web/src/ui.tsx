import type { CoinKey } from '@suijin/sdk';
import { useId, useSyncExternalStore, type ReactNode } from 'react';
import { explorer, toast } from './chain';
import { cleanAmount, fmt, short } from './format';

// Shared UI primitives. Formatting lives in format.ts (re-exported); page-specific pieces live with their page.
export * from './format';

// ---------- primitives ----------

export function Skeleton({ w = '100%', h = 16, r }: { w?: number | string; h?: number | string; r?: number }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

export function CoinIcon({ coin, size = 28 }: { coin: CoinKey; size?: number }) {
  return (
    <span className={`coin coin-${coin}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }} aria-hidden="true">
      {coin === 'tUSD' ? '$' : '¥'}
    </span>
  );
}

export function Segmented<T extends string | number>(p: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  full?: boolean;
}) {
  return (
    <div className={`seg${p.full ? ' full' : ''}`} role="group" aria-label={p.label}>
      {p.options.map((o) => (
        <button type="button" key={String(o.value)} aria-pressed={o.value === p.value} onClick={() => p.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** In-card tabs (the selected one is a tinted pill). */
export function Tabs<T extends string>(p: { label: string; value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist" aria-label={p.label}>
      {p.tabs.map((t) => (
        <button key={t.value} type="button" role="tab" className="tab" aria-selected={t.value === p.value} onClick={() => p.onChange(t.value)}>
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Selectable cards with a title and a caption: a radio group that explains each choice. */
export function Options<T extends string | number>(p: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; title: ReactNode; caption?: ReactNode; icon?: ReactNode }[];
}) {
  return (
    <div className="options" role="radiogroup" aria-label={p.label} style={{ gridTemplateColumns: `repeat(${p.options.length}, minmax(0, 1fr))` }}>
      {p.options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" className="option" aria-checked={o.value === p.value} onClick={() => p.onChange(o.value)}>
          {o.icon}
          <b>{o.title}</b>
          {o.caption && <span>{o.caption}</span>}
        </button>
      ))}
    </div>
  );
}

/** 0..1 progress bar. `hot` = gold, for "almost used up". */
export function Meter({ value, hot, label }: { value: number; hot?: boolean; label: string }) {
  const v = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={`meter${hot ? ' hot' : ''}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}>
      <span style={{ width: `${v}%` }} />
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <span className="small">{children}</span>}
      {action}
    </div>
  );
}

export const Check = ({ size = 14 }: { size?: number }) => (
  <svg className="check" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Chevron = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const FlipArrows = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M6 3v13m0 0l-3-3m3 3l3-3M14 17V4m0 0l-3 3m3-3l3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export type StepState = 'todo' | 'active' | 'done' | 'error';

/** Vertical transaction progress: spinner on the active step, drawn check when done. */
export function Steps({ steps }: { steps: { title: string; detail?: ReactNode; state: StepState }[] }) {
  return (
    <ol className="steps" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.title} className="step" data-state={s.state} aria-current={s.state === 'active' ? 'step' : undefined}>
          <span className="step-mark">{s.state === 'done' ? <Check /> : s.state === 'error' ? '!' : s.state === 'active' ? '' : i + 1}</span>
          <span>
            {s.title}
            {s.detail && <small>{s.detail}</small>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function TxLink({ digest, children }: { digest: string; children?: ReactNode }) {
  return (
    <a href={explorer.tx(digest)} target="_blank" rel="noreferrer">
      {children ?? short(digest)} ↗
    </a>
  );
}

export function Addr({ a }: { a: string }) {
  return (
    <a className="mono" href={explorer.account(a)} target="_blank" rel="noreferrer" title={a}>
      {short(a)}
    </a>
  );
}

export function Toasts() {
  const items = useSyncExternalStore(toast.subscribe, toast.list);
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast${t.leaving ? ' leaving' : ''}`} data-kind={t.kind} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span className="t-icon">{t.kind === 'success' ? <Check size={12} /> : t.kind === 'error' ? '!' : null}</span>
          <div>
            <div className="t-title">{t.title}</div>
            {t.body && <div className="t-body">{t.body}</div>}
            {t.href && (
              <a className="small" href={t.href} target="_blank" rel="noreferrer">
                View on Suiscan ↗
              </a>
            )}
          </div>
          <button type="button" className="t-close" aria-label="Dismiss" onClick={() => toast.dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------- token amount panel ----------

export function AmountPanel(p: {
  label: string;
  coin: CoinKey;
  value: string;
  /** Omit for a read-only (quoted) amount. */
  onChange?: (v: string) => void;
  /** Swap the coin (the demo has two): shows the chip as a button. */
  onCoin?: () => void;
  /** undefined = hide, null = loading. */
  balance?: bigint | null;
  onMax?: () => void;
  loading?: boolean;
  invalid?: boolean;
  footer?: ReactNode;
  autoFocus?: boolean;
  /** Border instead of fill: the receiving side of a trade. */
  outline?: boolean;
}) {
  const id = useId();
  const chip = (
    <>
      <CoinIcon coin={p.coin} size={26} />
      {p.coin}
    </>
  );
  return (
    <div className={`panel${p.outline ? ' outline' : ''}${p.invalid ? ' invalid' : ''}`}>
      <div className="panel-top">
        <label htmlFor={id}>{p.label}</label>
        {p.balance !== undefined && (
          <span className="inline">
            Balance {p.balance === null ? <Skeleton w={52} h={12} /> : <span className="num">{fmt(p.balance)}</span>}
            {p.onMax && p.balance !== null && (
              <button type="button" className="max" onClick={p.onMax}>
                MAX
              </button>
            )}
          </span>
        )}
      </div>
      <div className="panel-main">
        {p.loading ? (
          <span className="amount" aria-busy="true">
            <Skeleton w="55%" h={32} />
          </span>
        ) : (
          <input
            id={id}
            className="amount"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.00"
            value={p.value}
            readOnly={!p.onChange}
            tabIndex={p.onChange ? undefined : -1}
            autoFocus={p.autoFocus}
            aria-invalid={p.invalid || undefined}
            onChange={(e) => p.onChange?.(cleanAmount(e.target.value))}
          />
        )}
        {p.onCoin ? (
          <button type="button" className="token token-btn" onClick={p.onCoin} aria-label={`${p.coin}, switch coin`}>
            {chip}
            <Chevron />
          </button>
        ) : (
          <span className="token">{chip}</span>
        )}
      </div>
      {p.footer && <div className="panel-bottom">{p.footer}</div>}
    </div>
  );
}
