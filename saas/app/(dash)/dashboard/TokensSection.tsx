'use client'

import { useCallback, useEffect, useState } from 'react'

interface ChromeRuntimeSendMessageResponse {
  ok?: boolean
  error?: string
}

interface ChromeRuntimeApi {
  runtime?: {
    sendMessage: (
      extId: string,
      msg: { type: string; token: string; apiBase: string },
      callback: (resp: ChromeRuntimeSendMessageResponse | undefined) => void,
    ) => void
  }
}

export interface TokenRow {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string | null
  revoked: boolean
}

interface TokensSectionProps {
  initialTokens: TokenRow[]
}

interface GenerateResponse {
  token: string
  label: string
  createdAt: string
  warning: string
}

interface ListResponse {
  tokens: TokenRow[]
}

export default function TokensSection({ initialTokens }: TokensSectionProps) {
  const [tokens, setTokens] = useState<TokenRow[]>(initialTokens)
  const [label, setLabel] = useState<string>('Chrome Extension')
  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [plaintext, setPlaintext] = useState<string | null>(null)
  const [copied, setCopied] = useState<boolean>(false)
  const [extId, setExtId] = useState<string | null>(null)
  const [sendStatus, setSendStatus] = useState<string | null>(null)

  useEffect(() => {
    setExtId(sessionStorage.getItem('lw_extId'))
  }, [])

  const sendToExtension = (token: string): void => {
    const apiBase = window.location.origin
    try {
      const chromeApi = (window as unknown as { chrome?: ChromeRuntimeApi }).chrome
      if (!chromeApi?.runtime?.sendMessage || !extId) {
        setSendStatus('Chrome extension not detected. Copy the token manually below.')
        return
      }
      chromeApi.runtime.sendMessage(
        extId,
        { type: 'SET_API_TOKEN', token, apiBase },
        (response) => {
          if (response?.ok) {
            setSendStatus(
              'ส่งไปยัง Extension สำเร็จ! ปิดหน้านี้และกลับไปที่ Chrome / Sent! Close this tab and return to Chrome.',
            )
          } else {
            setSendStatus(
              `${response?.error ?? 'Failed to reach extension'}. Copy the token manually below.`,
            )
          }
        },
      )
    } catch (e) {
      setSendStatus(`${e instanceof Error ? e.message : 'unknown error'}. Copy manually.`)
    }
  }

  const refresh = useCallback(async (): Promise<void> => {
    const res = await fetch('/api/tokens/list', { cache: 'no-store' })
    if (!res.ok) return
    const body = (await res.json()) as ListResponse
    setTokens(body.tokens)
  }, [])

  async function generate(): Promise<void> {
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const res = await fetch('/api/tokens/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      if (!res.ok) {
        setError('Failed to generate token')
        return
      }
      const body = (await res.json()) as GenerateResponse
      setPlaintext(body.token)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string): Promise<void> {
    if (!confirm('Revoke this token? The extension using it will stop working.')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/tokens/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        setError('Failed to revoke token')
        return
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function copy(): Promise<void> {
    if (!plaintext) return
    await navigator.clipboard.writeText(plaintext)
    setCopied(true)
  }

  function dismissPlaintext(): void {
    setPlaintext(null)
    setCopied(false)
  }

  return (
    <section style={{ marginTop: 24, padding: 16, border: '1px solid #ddd', borderRadius: 8 }}>
      <h2 style={{ margin: 0 }}>Chrome Extension Connection</h2>
      <p style={{ fontSize: 13, color: '#555' }}>
        Generate an API token to connect the LiveWatch Chrome extension to your account.
      </p>

      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

      {plaintext ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: '#fff8e1',
            border: '2px solid #f9a825',
            borderRadius: 6,
          }}
        >
          <strong style={{ color: '#b26a00' }}>
            Save this token now — it will not be shown again.
          </strong>
          <pre
            style={{
              marginTop: 8,
              padding: 8,
              background: '#fff',
              border: '1px solid #e0e0e0',
              borderRadius: 4,
              fontSize: 13,
              wordBreak: 'break-all',
              whiteSpace: 'pre-wrap',
            }}
          >
            {plaintext}
          </pre>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {extId ? (
              <button
                type="button"
                onClick={() => sendToExtension(plaintext)}
                style={{
                  padding: '8px 16px',
                  background: '#1565c0',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ส่งไปยัง Extension / Send to Extension
              </button>
            ) : null}
            <button type="button" onClick={copy} style={{ padding: '6px 12px' }}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button type="button" onClick={dismissPlaintext} style={{ padding: '6px 12px' }}>
              I have saved it
            </button>
          </div>
          {sendStatus ? (
            <p style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>{sendStatus}</p>
          ) : null}
          {!extId ? (
            <p style={{ fontSize: 12, marginTop: 8, marginBottom: 0, color: '#777' }}>
              Open this page from the Chrome extension Settings to enable direct send.
            </p>
          ) : null}
        </div>
      ) : (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. My laptop)"
            style={{ padding: '6px 8px', flex: 1, border: '1px solid #ccc', borderRadius: 4 }}
          />
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            style={{ padding: '8px 16px' }}
          >
            {busy ? '...' : 'Generate token'}
          </button>
        </div>
      )}

      <ul style={{ marginTop: 16, padding: 0, listStyle: 'none' }}>
        {tokens.length === 0 ? (
          <li style={{ fontSize: 13, color: '#888' }}>No tokens yet.</li>
        ) : (
          tokens.map((t) => (
            <li
              key={t.id}
              style={{
                padding: 10,
                marginBottom: 6,
                border: '1px solid #eee',
                borderRadius: 4,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                opacity: t.revoked ? 0.5 : 1,
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>
                  {t.label}
                  {t.revoked ? (
                    <span style={{ color: 'crimson', marginLeft: 8, fontSize: 12 }}>
                      revoked
                    </span>
                  ) : null}
                </div>
                <div style={{ fontSize: 11, color: '#777' }}>
                  Created {new Date(t.createdAt).toLocaleString()}
                  {t.lastUsedAt
                    ? ` · Last used ${new Date(t.lastUsedAt).toLocaleString()}`
                    : ' · Never used'}
                </div>
              </div>
              {!t.revoked ? (
                <button
                  type="button"
                  onClick={() => void revoke(t.id)}
                  disabled={busy}
                  style={{ padding: '4px 10px', fontSize: 12 }}
                >
                  Revoke
                </button>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </section>
  )
}
