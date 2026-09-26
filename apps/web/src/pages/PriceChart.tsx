import type { CoinKey } from '@suijin/sdk';
import { useId, useState } from 'react';

// "Your price as you sell": x = how much of the budget has sold, y = the trader price in tJPY per
// tUSD. Same math as strategy::quote (constant product on virtual reserves, fee on the input),
// in floats because it is only drawn.

type Props = {
  coin: CoinKey; // what the provider sells
  amount: number; // budget, in whole coins
  mid: number; // entered price, tJPY per tUSD
  fee: number; // 0.003 = 0.30%
  shape: 'fixed' | 'curve';
  depth: number; // virtual pool = amount × depth
};

const W = 300;
const H = 120;
const N = 64;
const nf = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: x < 10 ? 3 : 2 });

export function model({ coin, amount, mid, fee, shape, depth }: Props) {
  const sellsJpy = coin === 'tJPY';
  const start = sellsJpy ? mid * (1 - fee) : shape === 'curve' ? mid / (1 - fee) : mid * (1 + fee);
  // Full range (depth 1) never sells out: draw the first 90% and say so.
  const xMax = shape === 'curve' && depth <= 1 ? amount * 0.9 : amount;
  const vb = amount * depth;
  const vq = sellsJpy ? vb / mid : vb * mid;
  const k = vb * vq;
  const priceAt = (x: number) =>
    shape === 'fixed' ? start : sellsJpy ? ((1 - fee) * (vb - x) ** 2) / k : k / (vb - x) ** 2 / (1 - fee);
  const receivedAt = (x: number) =>
    shape === 'fixed' ? (sellsJpy ? x / start : x * start) : (k / (vb - x) - vq) / (1 - fee);
  return { start, xMax, priceAt, receivedAt, partial: xMax < amount };
}

export function PriceChart(p: Props) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null); // 0..1 along the x axis
  const { xMax, priceAt, receivedAt, partial } = model(p);
  const pay = p.coin === 'tJPY' ? 'tUSD' : 'tJPY';

  const ys = Array.from({ length: N + 1 }, (_, i) => priceAt((xMax * i) / N));
  const lo = Math.min(...ys, p.mid);
  const hi = Math.max(...ys, p.mid);
  const pad = Math.max((hi - lo) * 0.12, p.mid * 0.004);
  const y = (v: number) => H - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * H;
  const pts = ys.map((v, i) => `${((i / N) * W).toFixed(2)},${y(v).toFixed(2)}`);
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${W},${H} L0,${H} Z`;
  const midY = y(p.mid);

  const f = hover ?? 1;
  const sold = xMax * f;
  const priceNow = priceAt(sold);
  const got = receivedAt(sold);

  return (
    <figure className="pchart" aria-label={`Your price as your ${p.coin} sells`}>
      <figcaption className="spread small">
        <span className="muted">Your price as it sells</span>
        <span className="faint">tJPY per tUSD</span>
      </figcaption>
      <div
        className="pchart-plot"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-labelledby={`${id}-t`}>
          <title id={`${id}-t`}>
            {`Price from ${nf(ys[0]!)} to ${nf(ys[N]!)} tJPY per tUSD as ${nf(xMax)} ${p.coin} sells`}
          </title>
          <defs>
            <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id}-g)`} />
          <line x1="0" x2={W} y1={midY} y2={midY} className="pchart-ref" vectorEffect="non-scaling-stroke" />
          <path d={line} className="pchart-line" vectorEffect="non-scaling-stroke" />
          {hover !== null && <line x1={f * W} x2={f * W} y1="0" y2={H} className="pchart-cross" vectorEffect="non-scaling-stroke" />}
        </svg>
        <span className="pchart-dot" style={{ left: `${f * 100}%`, top: `${(y(priceNow) / H) * 100}%` }} />
        <span className="pchart-reflabel" style={{ top: `${(midY / H) * 100}%` }}>
          market {nf(p.mid)}
        </span>
      </div>
      <div className="spread small pchart-axis">
        <span>
          <b className="num">{nf(ys[0]!)}</b> <span className="faint">at start</span>
        </span>
        <span>
          <b className="num">{nf(ys[N]!)}</b> <span className="faint">{partial ? 'at 90% sold' : 'all sold'}</span>
        </span>
      </div>
      <p className="pchart-tip" aria-live="polite">
        {hover === null ? 'Hover or drag across the chart: ' : ''}after selling <b>{nf(sold)} {p.coin}</b>, your price is <b>{nf(priceNow)}</b> and you have
        received <b className="gold">{nf(got)} {pay}</b>.
      </p>
    </figure>
  );
}
