import { useEffect, useRef, useState } from 'react'

// Easter egg: the dragon spirit (logo) evolves into Suijin, handheld-game style.
// White silhouettes swap faster and faster, a flash, then the reveal.

const CHAR = '/suijin-char.png'
const GAPS = [700, 560, 450, 360, 290, 230, 180, 140, 110, 90, 72, 60, 50, 44, 40, 40, 40, 40] // ms between swaps
const SPARKS = 16

type Phase = 'idle' | 'charging' | 'flash' | 'done'

export default function Evolve() {
  const dialog = useRef<HTMLDialogElement>(null)
  const timers = useRef<number[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [evolved, setEvolved] = useState(false) // which silhouette shows while charging
  const clear = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  useEffect(() => clear, [])

  const preload = () => {
    new Image().src = CHAR
  }
  const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms))

  const start = () => {
    clear()
    setEvolved(false)
    setPhase('charging')
    dialog.current?.showModal()
    const gaps = matchMedia('(prefers-reduced-motion: reduce)').matches ? [] : GAPS
    let t = 1200
    gaps.forEach((g, i) => at((t += g), () => setEvolved(i % 2 === 0)))
    at((t += 250), () => setPhase('flash'))
    at((t += 650), () => {
      setEvolved(true)
      setPhase('done')
    })
  }

  return (
    <>
      <button type="button" className="evo-btn" onClick={start} onPointerEnter={preload} onFocus={preload}>
        <img src="/logo.png" alt="" />
        Evolve
      </button>
      <dialog
        ref={dialog}
        className={`evo ${phase}`}
        aria-label="Suijin evolution"
        onClose={() => {
          clear()
          setPhase('idle')
        }}
      >
        <div className="evo-stage" aria-hidden="true">
          <div className="evo-rays" />
          {/* the logo has an opaque black ground, so its silhouette comes from a luminance mask */}
          <span className={`evo-spirit${evolved ? '' : ' on'}`}>
            <i />
          </span>
          <svg width="0" height="0" style={{ position: 'absolute' }}>
            {/* alpha = 4a - 0.4: the mask's mid-grey teal turns solid, the near-black ground drops out */}
            <filter id="evo-solid">
              <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 4 -0.4" />
            </filter>
          </svg>
          {phase !== 'idle' && <img className={`evo-char${evolved ? ' on' : ''}`} src={CHAR} alt="" />}
          {phase === 'done' && (
            <div className="evo-sparks">
              {Array.from({ length: SPARKS }, (_, i) => (
                <i key={i} style={{ '--a': `${(360 / SPARKS) * i}deg`, '--d': `${(i % 4) * 60}ms` } as React.CSSProperties} />
              ))}
            </div>
          )}
          <div className="evo-flash" />
        </div>
        <div className="evo-box">
          <p aria-live="polite">
            {phase === 'done' ? (
              <>
                Congratulations! Your dragon spirit evolved into <b>SUIJIN</b>, Keeper of the Tides!
              </>
            ) : (
              'What? The dragon spirit is evolving!'
            )}
          </p>
          {phase === 'done' && (
            <form method="dialog">
              <button className="evo-ok">Continue ▸</button>
            </form>
          )}
        </div>
        <form method="dialog">
          <button className="evo-x" aria-label="Close">
            ×
          </button>
        </form>
      </dialog>
    </>
  )
}
