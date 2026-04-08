import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

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
    <html lang="th">
      <body>
        {children}
        <footer
          style={{
            marginTop: 64,
            padding: '24px',
            borderTop: '1px solid var(--border)',
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--text-muted)',
          }}
        >
          <a href="/" style={{ color: 'var(--text-muted)', margin: '0 12px' }}>
            Home
          </a>
          <a href="/privacy" style={{ color: 'var(--text-muted)', margin: '0 12px' }}>
            Privacy Policy
          </a>
          <a href="/terms" style={{ color: 'var(--text-muted)', margin: '0 12px' }}>
            Terms of Service
          </a>
        </footer>
      </body>
    </html>
  )
}
