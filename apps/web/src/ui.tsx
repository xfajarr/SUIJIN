import { fetchCoinInfo, type CoinKey } from '@suijin/sdk';
import { useId, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { addToken, coin, explorer, friendlyError, toast, useTokens } from './chain';
import { amt, cleanAmount, rate, short } from './format';

// Shared UI primitives. Formatting lives in format.ts (re-exported); page-specific pieces live with their page.
export * from './format';

// ---------- token amounts: decimals come from the registry ----------

/** Raw amount of token `key` for display. */
export const fmtAmt = (v: bigint, key: CoinKey, maxFraction?: number) => amt(v, coin(key).decimals, maxFraction);
/** "1,500 tJPY". */
export const fmtCoin = (v: bigint, key: CoinKey) => `${fmtAmt(v, key)} ${key}`;
/** Whole `out` per whole `inp`, from raw amounts of two tokens. */
export const rateOf = (out: bigint, outKey: CoinKey, inp: bigint, inKey: CoinKey) => rate(out, coin(outKey).decimals, inp, coin(inKey).decimals);

// ---------- primitives ----------

export function Skeleton({ w = '100%', h = 16, r }: { w?: number | string; h?: number | string; r?: number }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

const GLYPH: Record<string, string> = { tUSD: '$', tJPY: '¥' };

/** Token logo: its icon URL, a glyph for the demo coins, else its first letter. */
export function CoinIcon({ coin: key, size = 28 }: { coin: CoinKey; size?: number }) {
  const info = coin(key);
  const [broken, setBroken] = useState(false);
  if (info.iconUrl && !broken)
    return <img className="coin coin-img" src={info.iconUrl} alt="" width={size} height={size} onError={() => setBroken(true)} aria-hidden="true" />;
  return (
    <span className={`coin coin-${key.replace(/[^\w]/g, '')}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }} aria-hidden="true">
      {GLYPH[key] ?? info.symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}

const COIN_TYPE = /^0x[0-9a-fA-F]{1,64}::\w+::\w+$/;

/**
 * Token list in a modal: search by symbol or name, or paste any coin type to add it from its
 * on-chain metadata. `exclude` is the other side of the pair.
 */
export function TokenPicker(p: {
  value: CoinKey;
  exclude?: CoinKey;
  onPick: (key: CoinKey) => void;
  balances?: Record<CoinKey, bigint> | null;
  label: string;
  /** 'card': a large trigger with the token name, for choosing a pair. */
  variant?: 'chip' | 'card';
  /** Small caption on the card trigger, e.g. "Base". */
  caption?: string;
}) {
  const list = useTokens();
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  // showModal focuses the first button (close); start in the search field instead.
  const open = () => {
    setQ('');
    dialog.current?.showModal();
    search.current?.focus();
  };
  const [adding, setAdding] = useState(false);
  const query = q.trim();
  const isType = COIN_TYPE.test(query);
  const shown = list.filter((t) => t.key !== p.exclude && (isType ? t.type.toLowerCase() === query.toLowerCase() : `${t.symbol} ${t.name}`.toLowerCase().includes(query.toLowerCase())));
  const pick = (key: CoinKey) => {
    p.onPick(key);
    dialog.current?.close();
  };
  const add = async () => {
    setAdding(true);
    try {
      const info = await fetchCoinInfo(query);
      if (!info) toast.push({ kind: 'error', title: 'Not a coin', body: 'No coin metadata for that type on this network.' });
      else pick(addToken(info).key);
    } catch (e) {
      toast.push({ kind: 'error', title: 'Could not add token', body: friendlyError(e) });
    } finally {
      setAdding(false);
    }
  };
  return (
    <>
      {p.variant === 'card' ? (
        <button type="button" className="token-card" onClick={open} aria-label={`${p.value}, ${p.label}`}>
          <CoinIcon coin={p.value} size={36} />
          <span className="token-card-text">
            {p.caption && <small>{p.caption}</small>}
            <b>{p.value}</b>
            <span>{coin(p.value).name}</span>
          </span>
          <Chevron />
        </button>
      ) : (
        <button type="button" className="token token-btn" onClick={open} aria-label={`${p.value}, ${p.label}`}>
          <CoinIcon coin={p.value} size={26} />
          {p.value}
          <Chevron />
        </button>
      )}
      <dialog ref={dialog} className="picker" aria-label={p.label} onClick={(e) => e.target === dialog.current && dialog.current?.close()}>
        <div className="picker-head">
          <strong>{p.label}</strong>
          <button type="button" className="icon-x" aria-label="Close" onClick={() => dialog.current?.close()}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <input ref={search} className="picker-search" placeholder="Search, or paste a coin type 0x…::coin::COIN" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
        <ul className="picker-list">
          {shown.map((t, i) => (
            <li key={t.key} style={{ '--i': Math.min(i, 8) } as CSSProperties}>
              <button type="button" aria-current={t.key === p.value || undefined} onClick={() => pick(t.key)}>
                <CoinIcon coin={t.key} size={32} />
                <span>
                  <b>{t.symbol}</b>
                  <small>{t.name}</small>
                </span>
                {p.balances?.[t.key] !== undefined && p.balances[t.key]! > 0n && <span className="num small">{amt(p.balances[t.key]!, t.decimals)}</span>}
              </button>
            </li>
          ))}
          {isType && shown.length === 0 && (
            <li>
              <button type="button" onClick={add} disabled={adding}>
                <span className="coin" style={{ width: 32, height: 32 }}>+</span>
                <span>
                  <b>{adding ? 'Looking up…' : 'Add this token'}</b>
                  <small className="mono">{short(query)}</small>
                </span>
              </button>
            </li>
          )}
          {!isType && shown.length === 0 && <li className="picker-empty small">No match. Paste the full coin type to add any token.</li>}
        </ul>
      </dialog>
    </>
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
    <div className="options" role="radiogroup" aria-label={p.label} style={{ gridTemplateColumns: `repeat(${p.options.length > 3 ? 2 : p.options.length}, minmax(0, 1fr))` }}>
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
  /** Pick another token: shows the chip as a picker. `exclude` is the other side of the pair. */
  onPick?: (key: CoinKey) => void;
  exclude?: CoinKey;
  /** Balances shown next to each token in the picker. */
  balances?: Record<CoinKey, bigint> | null;
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
  const { decimals } = coin(p.coin);
  return (
    <div className={`panel${p.outline ? ' outline' : ''}${p.invalid ? ' invalid' : ''}`}>
      <div className="panel-top">
        <label htmlFor={id}>{p.label}</label>
        {p.balance !== undefined && (
          <span className="inline">
            Balance {p.balance === null ? <Skeleton w={52} h={12} /> : <span className="num">{amt(p.balance, decimals)}</span>}
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
            onChange={(e) => p.onChange?.(cleanAmount(e.target.value, decimals))}
          />
        )}
        {p.onPick ? (
          <TokenPicker value={p.coin} exclude={p.exclude} onPick={p.onPick} balances={p.balances} label={`Select token: ${p.label}`} />
        ) : (
          <span className="token">
            <CoinIcon coin={p.coin} size={26} />
            {p.coin}
          </span>
        )}
      </div>
      {p.footer && <div className="panel-bottom">{p.footer}</div>}
    </div>
  );
}
