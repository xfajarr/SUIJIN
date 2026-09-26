const APP_URL = 'https://suijin-app.xfajarr-web3.workers.dev'
const REPO_URL = 'https://github.com/xfajarr/SUIJIN'
const PACKAGE_URL = 'https://suiscan.xyz/testnet/object/0x9d82a68d5c4bbc3630bc9a02953970f4a435edab056f5126af64f59796c0b502'

// Brand marks from simple-icons (lucide dropped its brand icons).
const SOCIALS = [
  {
    label: 'GitHub',
    href: REPO_URL,
    d: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  },
  // ponytail: X and Telegram handles not decided yet, links go nowhere until they exist
  { label: 'X', href: '#top', d: 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z' },
  {
    label: 'Telegram',
    href: '#top',
    d: 'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z',
  },
]

const COLUMNS: [string, [string, string][]][] = [
  ['Product', [['Launch app', APP_URL], ['How it works', '#how'], ['Markets', '#markets']]],
  ['Protocol', [['Allowances', '#how'], ['Strategies', '#how'], ['Resolver', '#how'], ['Settlement', '#how']]],
  ['Build', [['GitHub', REPO_URL], ['Package on Suiscan', PACKAGE_URL], ['Sui Allowances', 'https://docs.sui.io']]],
]

const external = (href: string) => (href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})

function FooterCard() {
  return (
    <div className="ft-card">
      <div className="ft-inner">
        <div className="ft-brand">
          <a className="ft-logo" href="#top">
            <img src="/logo.png" alt="" />
            Suijin
          </a>
          <p>Shared liquidity native to Sui. One wallet balance backs many markets, and funds move only when a trade settles.</p>
          <div className="ft-socials">
            {SOCIALS.map((s) => (
              <a key={s.label} href={s.href} aria-label={s.label} {...external(s.href)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={s.d} />
                </svg>
              </a>
            ))}
          </div>
        </div>
        {COLUMNS.map(([title, links]) => (
          <nav key={title} className="ft-col" aria-label={title}>
            <h4>{title}</h4>
            <ul>
              {links.map(([label, href]) => (
                <li key={label}>
                  <a href={href} {...external(href)}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="ft-legal">
        <p>© 2026 Suijin. Unaudited hackathon build.</p>
        <div>
          <span>Sui testnet only</span>
          <i aria-hidden="true" />
          <span>Built at ETHGlobal Tokyo</span>
        </div>
      </div>
    </div>
  )
}

// Hidden SVG filter gives the giant wordmark an embossed glass edge; GSAP fades it in when it scrolls into view.
function GlassText() {
  return (
    <div className="ft-glass" aria-hidden="true">
      <svg width="0" height="0" focusable="false">
        <defs>
          <filter id="glass-effect" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000000" floodOpacity="0.35" result="outer-shadow" />
            <feComponentTransfer in="SourceAlpha" result="alpha">
              <feFuncA type="linear" slope="1" />
            </feComponentTransfer>
            <feOffset in="alpha" dx="0" dy="4" result="offset-white" />
            <feGaussianBlur in="offset-white" stdDeviation="4" result="blur-white" />
            <feComposite in="alpha" in2="blur-white" operator="out" result="inner-white-mask" />
            <feFlood floodColor="#9ff5ea" floodOpacity="0.35" result="white-fill" />
            <feComposite in="white-fill" in2="inner-white-mask" operator="in" result="inner-white-final" />
            <feGaussianBlur in="alpha" stdDeviation="6" result="blur-black" />
            <feComposite in="alpha" in2="blur-black" operator="out" result="inner-black-mask" />
            <feFlood floodColor="#000000" floodOpacity="0.35" result="black-fill" />
            <feComposite in="black-fill" in2="inner-black-mask" operator="in" result="inner-black-final" />
            <feMerge>
              <feMergeNode in="outer-shadow" />
              <feMergeNode in="SourceGraphic" />
              <feMergeNode in="inner-white-final" />
              <feMergeNode in="inner-black-final" />
            </feMerge>
          </filter>
        </defs>
      </svg>
      <div className="ft-glass-word">Suijin</div>
    </div>
  )
}

export default function Footer() {
  return (
    <footer className="ft">
      <FooterCard />
      <GlassText />
    </footer>
  )
}
