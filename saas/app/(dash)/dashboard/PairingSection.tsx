'use client'

import { useCallback, useEffect, useState } from 'react'

interface PairingStatus {
  pairingCode: string | null
  pairingCodeExpiresAt: string | null
  linePaired: boolean
  pairedAt: string | null
}

export default function PairingSection() {
  const [status, setStatus] = useState<PairingStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    const res = await fetch('/api/pairing/status', { cache: 'no-store' })
    if (!res.ok) {
      setError('Failed to load pairing status')
      return
    }
    setStatus((await res.json()) as PairingStatus)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function regenerate(): Promise<void> {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/pairing/regenerate', { method: 'POST' })
    setBusy(false)
    if (!res.ok) {
      setError('Failed to regenerate code')
      return
    }
    await load()
  }

  return (
    <section style={{ marginTop: 24, padding: 16, border: '1px solid #ddd', borderRadius: 8 }}>
      <h2 style={{ margin: 0 }}>LINE Pairing</h2>
      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
      {status == null ? (
        <p>Loading…</p>
      ) : status.linePaired ? (
        <p>
          LINE connected{' '}
          {status.pairedAt ? <>(paired {new Date(status.pairedAt).toLocaleString()})</> : null}
        </p>
      ) : (
        <>
          <p>Send this code to the LiveWatch LINE bot to pair your account:</p>
          <pre
            style={{
              fontSize: 28,
              padding: 12,
              background: '#f0f0f0',
              borderRadius: 4,
              display: 'inline-block',
            }}
          >
            {status.pairingCode ?? '— none —'}
          </pre>
          {status.pairingCodeExpiresAt ? (
            <p style={{ fontSize: 12, color: '#666' }}>
              Expires {new Date(status.pairingCodeExpiresAt).toLocaleString()}
            </p>
          ) : null}
        </>
      )}
      <button
        type="button"
        onClick={regenerate}
        disabled={busy}
        style={{ marginTop: 12, padding: '8px 16px' }}
      >
        {busy ? '...' : 'Regenerate code'}
      </button>
    </section>
  )
}
