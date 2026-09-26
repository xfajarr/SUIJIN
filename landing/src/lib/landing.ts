import * as THREE from 'three'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const smooth = (a: number, b: number, t: number) => {
  const n = Math.max(0, Math.min(1, (t - a) / (b - a)))
  return n * n * (3 - 2 * n)
}

// Wires the preloader, cursor, scroll choreography and the WebGL scene. Returns a cleanup.
export function initLanding() {
  const html = document.documentElement
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const ac = new AbortController()
  const on = { signal: ac.signal, passive: true } as const
  let alive = true
  const timers: number[] = []

  const U = {
    uTime: { value: 0 },
    uPR: { value: 1 },
    uMorph: { value: 0 },
    uSpin: { value: 0 },
    uIntro: { value: reduce ? 1 : 0 },
    uHover: { value: 0 },
    uPointer: { value: new THREE.Vector2(-1e3, -1e3) },
    uRes: { value: new THREE.Vector2(innerWidth, innerHeight) },
  }
  let scroll = 0, px = 0, py = 0, introStart = Infinity

  // preloader
  const pre = document.querySelector<HTMLElement>('.preloader')!
  const pb = pre.querySelector('b')!
  const start = () => {
    html.classList.remove('is-loading')
    html.classList.add('intro-ready')
    introStart = performance.now()
  }
  if (reduce) {
    pre.classList.add('is-gone')
    start()
  } else {
    html.classList.add('is-loading')
    let pct = 0
    const tick = () => {
      if (!alive) return
      const done = document.readyState === 'complete'
      pct = Math.min(done ? 100 : 90, pct + (done ? 3 : 0.8))
      pb.textContent = String(pct | 0)
      if (pct < 100) return void requestAnimationFrame(tick)
      pre.classList.add('is-leaving')
      timers.push(window.setTimeout(() => pre.classList.add('is-gone'), 1100), window.setTimeout(start, 350))
    }
    tick()
  }

  // cursor + pointer
  const cur = document.querySelector<HTMLElement>('.custom-cursor')!
  const ct = { x: -100, y: -100 }, cp = { x: -100, y: -100 }
  const priceTag = cur.querySelector('.cx-price')!, timeTag = cur.querySelector('.cx-time')!
  const bidTag = cur.querySelector('.bid')!, askTag = cur.querySelector('.ask')!
  // ponytail: decorative readout, maps y to a SUI price band and x to a 09:00-21:00 JST session
  const price = (y: number) => 3.6 - (y / innerHeight) * 0.4
  const readout = (x: number, y: number) => {
    const p = price(y)
    priceTag.textContent = `SUI ${p.toFixed(4)}`
    bidTag.textContent = (p - 0.0003).toFixed(4)
    askTag.textContent = (p + 0.0003).toFixed(4)
    const m = 540 + Math.round((x / innerWidth) * 720)
    timeTag.textContent = `${String((m / 60) | 0).padStart(2, '0')}:${String(m % 60).padStart(2, '0')} JST`
    cur.style.setProperty('--tx', x > innerWidth - 260 ? '-238px' : '18px')
    cur.style.setProperty('--ty', y > innerHeight - 110 ? '-96px' : '18px')
  }
  // click drops a limit line that fills
  addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const o = document.createElement('div')
    o.className = 'cx-order'
    o.style.top = `${e.clientY}px`
    o.style.setProperty('--ox', `${e.clientX}px`)
    o.innerHTML = `<span>LIMIT ${price(e.clientY).toFixed(4)} · FILLED FROM SHARED BALANCE</span>`
    o.addEventListener('animationend', () => o.remove())
    cur.appendChild(o)
  }, on)
  addEventListener('pointermove', (e: PointerEvent) => {
    ct.x = e.clientX
    ct.y = e.clientY
    cur.classList.add('is-visible')
    cur.classList.toggle('is-hovering', e.target instanceof Element && !!e.target.closest('a'))
    px = e.clientX / innerWidth - 0.5
    py = e.clientY / innerHeight - 0.5
    U.uPointer.value.set(e.clientX, innerHeight - e.clientY)
    U.uHover.value = 1
  }, on)
  html.addEventListener('pointerleave', () => {
    cur.classList.remove('is-visible')
    U.uHover.value = 0
  }, on)

  // scroll-driven UI
  const hero = document.querySelector<HTMLElement>('.hero-ui')!
  const second = document.querySelector<HTMLElement>('.second-ui')!
  const chips = [...document.querySelectorAll<HTMLElement>('.chip')]
  // step cards: each plays its reveal once it scrolls into view
  const main = document.getElementById('top')!
  const header = document.querySelector<HTMLElement>('.site-header')!
  const steps = reduce
    ? null
    : gsap.context(() => {
        // scrub values > 0 add a trailing lag, so everything glides after the scrollbar instead of snapping to it
        const head = '.steps-head'
        gsap.fromTo(`${head} .kicker, ${head} p`,
          { y: 40, opacity: 0 },
          { y: 0, opacity: 1, stagger: 0.15, ease: 'power2.out', scrollTrigger: { trigger: head, start: 'top 90%', end: 'top 45%', scrub: 1.2 } })
        gsap.fromTo(`${head} .title-char`,
          { yPercent: 110, opacity: 0, filter: 'blur(10px)' },
          { yPercent: 0, opacity: 1, filter: 'blur(0px)', stagger: 0.03, ease: 'power3.out', scrollTrigger: { trigger: head, start: 'top 85%', end: 'top 35%', scrub: 1.2 } })

        gsap.fromTo('.ft-glass-word', { opacity: 0, scale: 0.98 }, {
          opacity: 1, scale: 1, duration: 1.8, ease: 'expo.out',
          scrollTrigger: { trigger: '.ft-glass', start: 'top 90%', toggleActions: 'play none none reverse' },
        })

        const items = gsap.utils.toArray<HTMLElement>('.step-card')
        items.forEach((card) => {
          // one timeline per card: card rises and sharpens, text staggers in,
          // then the illustration builds (rows, bar fills, quote slide-ins, arrows drawing)
          const q = (sel: string) => card.querySelectorAll(sel)
          // plays through on its own once the card is in view (not tied to scroll position)
          const tl = gsap.timeline({
            defaults: { ease: 'power3.out' },
            scrollTrigger: { trigger: card, start: 'top 82%', toggleActions: 'play none none reverse' },
          })
          tl.from(card.querySelector('.step-inner'), { y: 140, scale: 0.95, opacity: 0, filter: 'blur(10px)', duration: 1 })
            .from(q('.step-text > *'), { y: 26, opacity: 0, stagger: 0.12, duration: 0.6 }, 0.35)
            .from(q('.viz'), { x: 48, opacity: 0, duration: 0.7 }, 0.45)
            .from(q('.viz > *'), { y: 14, opacity: 0, stagger: 0.08, duration: 0.5 }, 0.7)
            .from(q('.viz-bar i'), { scaleX: 0, stagger: 0.12, duration: 0.7, ease: 'power2.inOut' }, 0.9)
            .from(q('.viz-quote'), { x: 36, stagger: 0.1, duration: 0.6 }, 0.8)
            .fromTo(q('.viz-flow .arrow'), { backgroundSize: '0% 100%', '--head': 0 }, { backgroundSize: '100% 100%', '--head': 1, stagger: 0.2, duration: 0.7, ease: 'power2.inOut' }, 0.9)
            .from(q('.viz-flow .arrow em'), { y: 8, opacity: 0, stagger: 0.2, duration: 0.4 }, 1.2)
          gsap.fromTo(card.querySelector('[data-parallax]'), { yPercent: 40 }, {
            yPercent: -20, ease: 'none',
            scrollTrigger: { trigger: card, start: 'top bottom', end: 'top top', scrub: 1.4 },
          })
        })
      })

  const onScroll = () => {
    // the 3D story is driven by the tall <main>; the steps section below scrolls normally
    const span = main.offsetHeight - innerHeight
    scroll = Math.min(1, scrollY / Math.max(1, span))
    const past = smooth(0, innerHeight * 0.45, scrollY - span)
    header.classList.toggle('is-solid', scrollY > span + innerHeight * 0.2)
    const out = smooth(0.1, 0.28, scroll), inn = smooth(0.76, 0.9, scroll)
    hero.style.opacity = String(1 - out)
    hero.style.transform = `translateY(${-out * 34}px)`
    hero.style.visibility = out > 0.99 ? 'hidden' : 'visible'
    second.style.opacity = String(inn > 0.01 ? 1 - past : 0)
    second.style.visibility = inn > 0.01 && past < 0.99 ? 'visible' : 'hidden'
    second.classList.toggle('is-inview', inn > 0.18)
  }
  addEventListener('scroll', onScroll, on)
  onScroll()
  const placeChips = (t: number) => {
    const vis = smooth(0.19, 0.31, scroll) * (1 - smooth(0.55, 0.67, scroll))
    chips.forEach((c, o) => {
      const d = (o / chips.length) * Math.PI * 2 + t * 0.13 + scroll * 5.8
      const f = (Math.sin(d) + 1) / 2
      const fx = Math.min(innerWidth * 0.39, 650), fy = Math.min(innerHeight * 0.33, 285)
      c.style.opacity = String(vis * smooth(0.3, 0.64, f))
      c.style.zIndex = String(Math.round(f * 20))
      c.style.transform = `translate(-50%,-50%) translate3d(${innerWidth * 0.5 + Math.cos(d) * fx}px,${innerHeight * 0.52 + Math.sin(d) * fy}px,${(f - 0.5) * 300}px) rotateY(${Math.cos(d) * -28}deg) scale(${0.68 + f * 0.38})`
    })
  }

  // WebGL scene; the UI above keeps working if this fails
  let renderer: THREE.WebGLRenderer | null = null
  let scene!: THREE.Scene, camera!: THREE.PerspectiveCamera, group!: THREE.Group
  try {
    const canvas = document.getElementById('scene') as HTMLCanvasElement
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
    renderer.setSize(innerWidth, innerHeight)
    U.uPR.value = renderer.getPixelRatio()
    scene = new THREE.Scene()
    scene.background = new THREE.Color(0x020807)
    camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100)
    camera.position.set(0, 3.1, 17)
    group = new THREE.Group()
    group.position.y = -0.38
    scene.add(group)
    loadHead().then((head) => alive && buildScene(scene, group, U, head))
    addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight
      camera.updateProjectionMatrix()
      renderer!.setSize(innerWidth, innerHeight)
      U.uRes.value.set(innerWidth, innerHeight)
    }, on)
  } catch (err) {
    console.warn('Scene disabled:', err)
    renderer = null
  }

  const t0 = performance.now()
  let last = 0
  const frame = (now: number) => {
    if (!alive) return
    const t = (now - t0) / 1000, dt = Math.min(0.05, t - last)
    last = t
    placeChips(reduce ? 0 : t)
    if (Math.abs(ct.x - cp.x) + Math.abs(ct.y - cp.y) > 0.1) {
      cp.x += (ct.x - cp.x) * 0.35
      cp.y += (ct.y - cp.y) * 0.35
      cur.style.setProperty('--x', `${cp.x}px`)
      cur.style.setProperty('--y', `${cp.y}px`)
      readout(cp.x, cp.y)
    }
    if (renderer) {
      const e = Math.max(0, Math.min(1, (scroll - 0.54) / 0.34))
      if (!reduce) U.uIntro.value = smooth(0, 1, (now - introStart) / 3400)
      U.uTime.value = reduce ? 0 : t
      U.uMorph.value = e
      if (!reduce) U.uSpin.value += dt * 0.3 * e
      group.position.y = -0.38 + e * 1.2
      group.scale.setScalar(1 - e * 0.12)
      group.rotation.y += (px * 0.12 * (1 - e) - group.rotation.y) * 0.035
      group.rotation.x += (py * 0.035 * (1 - e) + e * 0.2 - group.rotation.x) * 0.03
      camera.position.z = 17 - scroll * 0.7 + Math.sin(t * 0.34) * 0.11
      camera.position.y = 3.1 + Math.sin(t * 0.21) * 0.045
      camera.lookAt(0, 3.2, 0)
      renderer.render(scene, camera)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  return () => {
    alive = false
    ac.abort()
    timers.forEach(clearTimeout)
    html.classList.remove('is-loading', 'intro-ready')
    renderer?.dispose()
    steps?.revert()
  }
}

type Uniforms = Record<string, { value: unknown }>
type HeadPoint = { u: number; v: number; gold: boolean }

// Samples the logo so the dragon's head is the Suijin mark. Empty on failure; the body still renders.
async function loadHead(): Promise<HeadPoint[]> {
  try {
    const img = new Image()
    img.src = '/logo.png'
    await img.decode()
    const S = 160, c = document.createElement('canvas')
    c.width = c.height = S
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0, S, S)
    const d = ctx.getImageData(0, 0, S, S).data, out: HeadPoint[] = []
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const k = (y * S + x) * 4, r = d[k], g = d[k + 1], b = d[k + 2]
      if (Math.max(r, g, b) > 90) out.push({ u: x / S - 0.5, v: 0.5 - y / S, gold: r > b + 40 })
    }
    return out
  } catch {
    return []
  }
}

function buildScene(scene: THREE.Scene, group: THREE.Group, U: Uniforms, head: HeadPoint[]) {
  const add = <T extends THREE.Object3D>(o: T, order: number) => ((o.renderOrder = order), o)
  const glow = { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }
  const rnd = Math.random, gs = () => (rnd() + rnd() + rnd() - 1.5) / 1.5

  // particles: a water dragon that rises out of the pool (head sampled from the logo), then becomes
  // one core balance feeding four market clusters.
  // Body particles are stored in tube coordinates (t along the spine, angle, radius) and placed on the
  // spine in the shader, so the dragon can slide along its own path as it emerges.
  const N = innerWidth < 700 ? 11000 : 22000
  const pos = new Float32Array(N * 3), tgt = new Float32Array(N * 3), tube = new Float32Array(N * 3)
  const size = new Float32Array(N), phase = new Float32Array(N), gold = new Float32Array(N), kind = new Float32Array(N)
  const core = [0, 4.2, 0]
  const mk = [0, 1, 2, 3].map((k) => {
    const a = (k / 4) * Math.PI * 2 + 0.4
    return [Math.cos(a) * 3.5, 4.2 + Math.sin(a * 2) * 0.35, Math.sin(a) * 3.5]
  })
  const ball = (c: number[], r: number, o: Float32Array, j: number) => {
    const u = rnd() * 2 - 1, a = rnd() * 6.2832, rr = r * Math.cbrt(rnd()), s = Math.sqrt(1 - u * u)
    o[j] = c[0] + Math.cos(a) * s * rr
    o[j + 1] = c[1] + u * rr
    o[j + 2] = c[2] + Math.sin(a) * s * rr
  }
  // keep in sync with spine() in the shader
  const spine = (t: number) => {
    const A = 0.3 + 1.4 * smooth(0, 0.35, t) * (1 - 0.8 * smooth(0.75, 1, t))
    return [A * Math.sin(t * 5.2 + 1.083), -1 + t * 6.4, A * 0.6 * Math.cos(t * 3.6)]
  }
  const rad = (t: number) => 0.08 + 0.5 * smooth(0, 0.3, t) - 0.12 * smooth(0.7, 0.88, t) + 0.28 * smooth(0.9, 1, t)
  const HS = 3.4, HY = 6.3, HZ = 0.5 // head size and center
  const bez = (p0: number[], p1: number[], p2: number[], t: number) =>
    p0.map((v, k) => (1 - t) * (1 - t) * v + 2 * (1 - t) * t * p1[k] + t * t * p2[k])
  const headShare = head.length ? 0.3 : 0, BAND = 1 / 80, RING = 14
  for (let i = 0; i < N; i++) {
    const j = i * 3, roll = rnd()
    let g = 0, sz = 1.2 + rnd() * 2
    if (roll < headShare) {
      const h = head[Math.floor(rnd() * head.length)], px = HS / 160
      pos[j] = h.u * HS + (rnd() - 0.5) * px
      pos[j + 1] = HY + h.v * HS + (rnd() - 0.5) * px
      pos[j + 2] = HZ + Math.max(0, 0.45 * (1 - 4 * (h.u * h.u + h.v * h.v))) + gs() * 0.025
      g = h.gold ? 1 : 0
      kind[i] = 2
      sz = 1 + rnd() * 1.6
    } else if (roll < headShare + 0.05) {
      // whiskers trailing from the snout; tube.x carries the whisker parameter for the wave
      const side = rnd() < 0.5 ? -1 : 1, t = rnd()
      const w = bez([side * 0.18 * HS, HY - 0.3 * HS, HZ + 0.4], [side * 2.4, 4.3, 1.4], [side * 3.3, 5.6, 0.6], t)
      pos[j] = w[0] + gs() * 0.025; pos[j + 1] = w[1] + gs() * 0.025; pos[j + 2] = w[2] + gs() * 0.025
      tube[j] = t
      kind[i] = 2
      sz = 0.9 + rnd() * 1.3
    } else if (roll < headShare + 0.17) {
      // four legs in the spine's local frame (x: side, y: toward camera, z: along the body)
      const leg = Math.floor(rnd() * 4), side = leg % 2 ? 1 : -1, t = leg < 2 ? 0.34 : 0.7, r0 = rad(t)
      const sh = [side * r0 * 0.8, 0.1, 0], el = [side * (r0 + 0.7), 0.35, -0.35], wr = [side * (r0 + 1.05), 0.55, 0.12]
      const pick = rnd()
      let q: number[], thick: number
      if (pick < 0.4) {
        const u = rnd()
        q = sh.map((v, k) => v + (el[k] - v) * u)
        thick = 0.16 - u * 0.05
      } else if (pick < 0.72) {
        const u = rnd()
        q = el.map((v, k) => v + (wr[k] - v) * u)
        thick = 0.11 - u * 0.03
      } else {
        // claws fan out from the wrist, gold at the tips
        const c = Math.floor(rnd() * 4), a = (c - 1.5) * 0.45, u = rnd(), L = 0.34
        q = [wr[0] + side * Math.cos(a) * L * u, wr[1] + 0.12 * u, wr[2] + Math.sin(a) * L * u - 0.12 * u * u]
        thick = 0.045 * (1 - u)
        if (u > 0.6) g = 1
      }
      pos[j] = q[0] + gs() * thick; pos[j + 1] = q[1] + gs() * thick; pos[j + 2] = q[2] + gs() * thick
      tube[j] = t; tube[j + 1] = rnd() * 6.2832
      kind[i] = 3
      sz = 1 + rnd() * 1.6
    } else if (roll < headShare + 0.21) {
      // splash ring where the body breaks the surface
      const c = spine(0.124), a = rnd() * 6.2832, r = 0.35 + Math.pow(rnd(), 0.6) * 1.6
      pos[j] = c[0] + Math.cos(a) * r; pos[j + 1] = -0.25 + rnd() * 0.45 * (1.9 - r); pos[j + 2] = c[2] + Math.sin(a) * r
    } else {
      kind[i] = 1
      let t = rnd(), th: number, rr: number
      const r = rnd()
      if (r < 0.12) {
        // triangular dorsal fins, one sawtooth spike per 1/38 of the body
        t = 0.06 + rnd() * 0.9
        const f = (t * 38) % 1, u = rnd()
        th = gs() * 0.14
        rr = rad(t) + u * rad(t) * (0.3 + 1.5 * (1 - f)) * (1 - 0.4 * t)
        if (u > 0.8 && rnd() < 0.4) g = 1
      } else if (r < 0.3) {
        // pale belly plates
        t = (Math.floor(t / (BAND * 1.6)) + 0.5 + gs() * 0.3) * BAND * 1.6
        th = Math.PI + (rnd() - 0.5) * 1.1
        rr = rad(t) * 0.98
        g = 0.35
        sz = 1.6 + rnd() * 1.6
      } else if (r < 0.8) {
        // staggered scale rows
        const band = Math.floor(t / BAND)
        t = (band + 0.5 + gs() * 0.18) * BAND
        th = ((Math.floor(rnd() * RING) + (band % 2) * 0.5) / RING) * 6.2832 + gs() * 0.08
        rr = rad(t) * (0.96 + rnd() * 0.08)
      } else {
        th = rnd() * 6.2832
        rr = rad(t) * (0.55 + rnd() * 0.45)
      }
      tube[j] = t; tube[j + 1] = th; tube[j + 2] = rr
    }
    const grp = i % 6
    if (grp === 0) {
      ball(core, 1.15, tgt, j)
      if (rnd() < 0.18) g = 1
    } else if (grp < 5) ball(mk[grp - 1], 0.62, tgt, j)
    else {
      const m = mk[Math.floor(rnd() * 4)], t = rnd()
      tgt[j] = m[0] * t + gs() * 0.05
      tgt[j + 1] = core[1] + (m[1] - core[1]) * t + gs() * 0.05
      tgt[j + 2] = m[2] * t + gs() * 0.05
    }
    size[i] = sz
    phase[i] = rnd() * 20
    gold[i] = g
  }
  const geo = new THREE.BufferGeometry()
  const A = (n: string, a: Float32Array, s: number) => geo.setAttribute(n, new THREE.BufferAttribute(a, s))
  A('position', pos, 3); A('aTarget', tgt, 3); A('aTube', tube, 3); A('aSize', size, 1); A('aPhase', phase, 1); A('aGold', gold, 1); A('aKind', kind, 1)
  const POS = `attribute float aSize,aPhase,aGold,aKind;attribute vec3 aTarget,aTube;uniform float uTime,uPR,uMorph,uIntro,uHover,uSpin;uniform vec2 uPointer,uRes;
    vec3 spine(float t){float A=.3+1.4*smoothstep(0.,.35,t)*(1.-.8*smoothstep(.75,1.,t));return vec3(A*sin(t*5.2+1.083),-1.+t*6.4,A*.6*cos(t*3.6));}
    float rise(){return 1.-pow(1.-clamp(uIntro,0.,1.),3.);}
    vec3 dragon(){vec3 p;
      if(aKind>2.5){float t=aTube.x;vec3 C=spine(t),T=normalize(spine(t+.003)-spine(t-.003));
        vec3 N=normalize(cross(T,vec3(0.,0.,1.))),B=cross(N,T);C+=N*sin(t*14.-uTime*2.)*.07;
        vec3 q=position;q.z+=sin(uTime*1.6+t*9.)*.08*length(q.xy);p=C+N*q.x+B*q.y+T*q.z;}
      else if(aKind>1.5){p=position;p.y+=sin(aTube.x*8.-uTime*2.2)*.12*aTube.x;}
      else if(aKind>.5){float t=aTube.x;vec3 C=spine(t),T=normalize(spine(t+.003)-spine(t-.003));
        vec3 N=normalize(cross(T,vec3(0.,0.,1.))),B=cross(N,T);C+=N*sin(t*14.-uTime*2.)*.07;
        p=C+(N*cos(aTube.y)+B*sin(aTube.y))*aTube.z;}
      else return position;
      // rises straight up out of the pool in its final pose; anything below the surface is hidden by shown()
      p.y-=(1.-rise())*9.5;return p;}
    vec3 place(){float m=smoothstep(0.,1.,uMorph),live=1.-m;vec3 p=mix(dragon(),aTarget,m);
      p.y+=sin(uTime*.9)*.07*live*step(.5,aKind);
      float a=uSpin+sin(uTime*.35)*.22*live;p.xz=mat2(cos(a),-sin(a),sin(a),cos(a))*p.xz;
      p.x+=sin(uTime*.8+p.y*1.6+aPhase)*.015;return p;}
    float shown(vec3 p){float w=(modelMatrix*vec4(p,1.)).y,m=smoothstep(0.,1.,uMorph);
      return mix(smoothstep(-.72,-.5,w),1.,m)*(aKind<.5?mix(smoothstep(.1,.45,rise()),1.,m):1.);}`
  const body = add(new THREE.Points(geo, new THREE.ShaderMaterial({
    ...glow, uniforms: U,
    vertexShader: POS + `varying float vGlow,vDepth,vGold,vShown;void main(){vec3 p=place();vShown=shown(p);vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
      vec2 d=(gl_Position.xy/gl_Position.w*.5+.5)*uRes-uPointer;float r=clamp(1.-length(d)/180.,0.,1.);r=r*r*(3.-2.*r);
      gl_Position.xy+=normalize(d+vec2(.001))*r*uHover*rise()*.06*gl_Position.w;
      vDepth=clamp((-mv.z-8.)/14.,0.,1.);gl_PointSize=aSize*mix(1.28,.72,vDepth)*uPR*(27./-mv.z);vGlow=.62+.38*sin(aPhase+uTime*1.4);vGold=aGold;}`,
    fragmentShader: `varying float vGlow,vDepth,vGold,vShown;void main(){float d=length(gl_PointCoord-.5),c=smoothstep(.19,0.,d),h=smoothstep(.5,.08,d);
      vec3 col=mix(vec3(.16,.86,.78),vec3(.02,.22,.34),vDepth);col=mix(col,vec3(.75,1.,.96),c*.5);col=mix(col,vec3(1.,.72,.24),vGold);
      gl_FragColor=vec4(col,(c+h*.38)*vGlow*mix(1.,.48,vDepth)*vShown);}`,
  })), 20)
  // reflection in the water
  const reflection = add(new THREE.Points(geo, new THREE.ShaderMaterial({
    ...glow, uniforms: U,
    vertexShader: POS + `varying float vFade;void main(){vec3 p=place();vec4 w=modelMatrix*vec4(p,1.);float h=max(0.,w.y+.58);w.y=-.58-h*.66;
      w.x+=sin(h*7.5+w.x*1.7-uTime*1.4+aPhase)*(.025+h*.018);vec4 mv=viewMatrix*w;gl_Position=projectionMatrix*mv;
      vFade=shown(p)*exp(-h*.22)*(.38+.62*pow(.5+.5*sin(h*8.-uTime*1.3+aPhase*.15),3.));gl_PointSize=aSize*.8*uPR*(26./-mv.z);}`,
    fragmentShader: `varying float vFade;void main(){float d=length(gl_PointCoord-.5),c=smoothstep(.2,0.,d),h=smoothstep(.5,.055,d);
      gl_FragColor=vec4(mix(vec3(.01,.3,.32),vec3(.14,.86,.78),c),(c+h*.38)*vFade*.45);}`,
  })), 4)
  // positions come from the shader, so the buffer bounds are meaningless
  body.frustumCulled = reflection.frustumCulled = false
  group.add(body, reflection)

  // water surface
  const water = new THREE.Mesh(new THREE.PlaneGeometry(42, 26, 160, 100).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `uniform float uTime,uIntro;varying vec3 vP;void main(){vec3 p=position;float r=length(p.xz),burst=1.+2.2*sin(smoothstep(0.,1.,uIntro)*3.1416);p.y+=sin(r*3.1-uTime*1.8)*.12*burst*exp(-r*.065)+sin(p.x*1.35+uTime*.7)*.045+sin(p.z*1.8-uTime*.55)*.035;vP=p;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
    fragmentShader: `uniform float uTime,uIntro;varying vec3 vP;void main(){float r=length(vP.xz),w=.5+.5*sin(r*4.-uTime*1.7),rings=pow(w,14.4)*(1.+1.5*sin(smoothstep(0.,1.,uIntro)*3.1416)),halo=pow(w,5.5),fade=exp(-r*.1);
      float sh=pow(max(0.,sin(vP.x*2.8+uTime*.85)*cos(vP.z*4.2-uTime*.62)),18.)*fade;
      vec3 col=mix(vec3(.004,.03,.03),vec3(.03,.42,.44),rings*.5)+vec3(.12,.8,.72)*(sh*.3+halo*fade*.045);
      gl_FragColor=vec4(col,.48+fade*.18+rings*.11+halo*fade*.025+sh*.13);}`,
  }))
  water.position.y = -0.66
  scene.add(add(water, 0))

  // ripple sparks drifting outward
  const RN = 2100, rg = new THREE.BufferGeometry(), ra = new Float32Array(RN * 4)
  for (let i = 0; i < RN; i++) {
    ra[i * 4] = rnd() * 6.2832
    ra[i * 4 + 1] = i % 6
    ra[i * 4 + 2] = (rnd() - 0.5) * 0.42
    ra[i * 4 + 3] = rnd() * 20
  }
  rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RN * 3), 3))
  rg.setAttribute('aR', new THREE.BufferAttribute(ra, 4))
  const ripples = new THREE.Points(rg, new THREE.ShaderMaterial({
    ...glow, depthTest: true, uniforms: U,
    vertexShader: `attribute vec4 aR;uniform float uTime,uPR;varying float vA;void main(){float cy=mod(aR.y*2.25+uTime*.48,13.5),r=.7+cy+aR.z;
      vec3 p=vec3(cos(aR.x)*r,-.51+sin(r*3.1-uTime*1.8)*.105*exp(-r*.06),sin(aR.x)*r);float fl=.68+.32*sin(aR.w+uTime*.75);
      vA=smoothstep(.3,1.6,cy)*(1.-smoothstep(9.5,13.5,cy))*fl;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=(1.+fract(aR.w)*2.)*uPR*(25./-mv.z);}`,
    fragmentShader: `varying float vA;void main(){float d=length(gl_PointCoord-.5);gl_FragColor=vec4(mix(vec3(.02,.35,.38),vec3(.3,.95,.86),smoothstep(.18,0.,d)),(smoothstep(.18,0.,d)+smoothstep(.5,.06,d)*.38)*vA*.72);}`,
  }))
  ripples.frustumCulled = false // positions come from the shader, the buffer is all zeros
  scene.add(add(ripples, 3))

  // backdrop mist + stars
  const mist = new THREE.Mesh(new THREE.PlaneGeometry(18, 12), new THREE.ShaderMaterial({
    ...glow, uniforms: U,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 vUv;uniform float uTime;void main(){vec2 p=(vUv-.5)*vec2(1.1,1.45);gl_FragColor=vec4(.02,.28,.3,exp(-dot(p,p)*8.)*(.86+.14*sin(uTime*.18+vUv.y*5.))*.2);}`,
  }))
  mist.position.set(0, 3.5, -3.5)
  scene.add(add(mist, -2))
  const SN = 900, sg = new THREE.BufferGeometry(), sp = new Float32Array(SN * 3), ss = new Float32Array(SN)
  for (let i = 0; i < SN; i++) {
    sp[i * 3] = (rnd() - 0.5) * 34
    sp[i * 3 + 1] = 1 + rnd() * 16
    sp[i * 3 + 2] = -5 - rnd() * 13
    ss[i] = rnd() * 20
  }
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3))
  sg.setAttribute('aP', new THREE.BufferAttribute(ss, 1))
  scene.add(add(new THREE.Points(sg, new THREE.ShaderMaterial({
    ...glow, depthTest: true, uniforms: U,
    vertexShader: `attribute float aP;uniform float uTime,uPR;varying float vG;void main(){float tw=.5+.5*sin(aP+uTime*.34);vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=(.8+fract(aP)*2.)*(.86+tw*.3)*uPR*(28./-mv.z);vG=.42+.58*tw;}`,
    fragmentShader: `varying float vG;void main(){float d=length(gl_PointCoord-.5);gl_FragColor=vec4(vec3(.85,1.,.97),(smoothstep(.22,0.,d)+smoothstep(.5,.05,d)*.6)*vG*.8);}`,
  })), 1))
}
