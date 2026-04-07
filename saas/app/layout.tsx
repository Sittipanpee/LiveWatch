import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'LiveWatch',
  description: 'LiveWatch SaaS — TikTok Shop live monitoring',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          background: '#fafafa',
          color: '#111',
        }}
      >
        {children}
        <footer
          style={{
            marginTop: 64,
            padding: '24px',
            borderTop: '1px solid #e5e5e5',
            textAlign: 'center',
            fontSize: 13,
            color: '#666',
          }}
        >
          <a href="/" style={{ color: '#666', margin: '0 12px' }}>
            Home
          </a>
          <a href="/privacy" style={{ color: '#666', margin: '0 12px' }}>
            Privacy Policy
          </a>
          <a href="/terms" style={{ color: '#666', margin: '0 12px' }}>
            Terms of Service
          </a>
        </footer>
      </body>
    </html>
  )
}
