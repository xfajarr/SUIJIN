import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import appCss from '../styles.css?url'

const description =
  'Suijin is a Sui-native shared liquidity layer. One wallet balance backs an AMM, limit orders, RFQ and launch markets, and funds move only when a trade settles.'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: 'Suijin — One Balance, Many Markets' },
      { name: 'description', content: description },
      { name: 'theme-color', content: '#020807' },
      { property: 'og:title', content: 'Suijin — One Balance, Many Markets' },
      { property: 'og:description', content: description },
      { property: 'og:image', content: '/logo.png' },
    ],
    links: [
      { rel: 'icon', type: 'image/png', href: '/logo.png' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;600&family=Geist+Mono:wght@400&family=Pixelify+Sans:wght@400&display=swap',
      },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
