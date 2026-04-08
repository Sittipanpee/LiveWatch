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
        setSendStatus('ไม่พบ Chrome Extension กรุณาคัดลอก token ด้วยตนเอง / Extension not detected — copy manually.')
        return
      }
      chromeApi.runtime.sendMessage(
        extId,
        { type: 'SET_API_TOKEN', token, apiBase },
        (response) => {
          if (response?.ok) {
            setSendStatus(
              '✅ ส่งไปยัง Extension สำเร็จ! ปิดหน้านี้และกลับไปที่ Chrome / Sent! Close this tab and return to Chrome.',
            )
          } else {
            setSendStatus(
              `${response?.error ?? 'Failed to reach extension'} — กรุณาคัดลอกด้วยตนเอง / Copy manually.`,
            )
          }
        },
      )
    } catch (e) {
      setSendStatus(`${e instanceof Error ? e.message : 'unknown error'} — กรุณาคัดลอกด้วยตนเอง.`)
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
        setError('สร้าง token ไม่สำเร็จ / Failed to generate token')
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
    if (!confirm('ยกเลิก token นี้? Extension ที่ใช้อยู่จะหยุดทำงาน / Revoke this token?')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/tokens/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        setError('ยกเลิกไม่สำเร็จ / Failed to revoke token')
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
    <section className="card">
      <h2 style={{ marginTop: 0 }}>
        เชื่อมต่อ Chrome Extension <span className="label-en">/ Chrome Extension Connection</span>
      </h2>
      <p className="muted">
        สร้าง API token เพื่อเชื่อมต่อ LiveWatch Chrome extension กับบัญชีของคุณ
      </p>

      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

      {plaintext ? (
        <div
          style={{
            marginTop: 12,
            padding: 16,
            background: '#FFF9E6',
            border: '2px solid #D4AF37',
            borderRadius: 8,
          }}
        >
          <strong style={{ color: '#8a6d00' }}>
            ⚠️ บันทึก token นี้ไว้ตอนนี้ — ระบบจะไม่แสดงอีก / Save now — cannot be retrieved later
          </strong>
          <pre
            style={{
              marginTop: 10,
              padding: 10,
              background: '#fff',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 13,
              wordBreak: 'break-all',
              whiteSpace: 'pre-wrap',
              fontFamily: 'monospace',
            }}
          >
            {plaintext}
          </pre>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {extId ? (
              <button
                type="button"
                onClick={() => sendToExtension(plaintext)}
                className="btn-primary"
                style={{ fontSize: 16, padding: '14px 22px' }}
              >
                📤 ส่งไปยัง Extension
              </button>
            ) : null}
            <button type="button" onClick={copy} className="btn-secondary">
              {copied ? '✅ คัดลอกแล้ว / Copied!' : '📋 คัดลอก / Copy'}
            </button>
            <button
              type="button"
              onClick={dismissPlaintext}
              className="btn-secondary"
            >
              บันทึกแล้ว / I have saved it
            </button>
          </div>
          {sendStatus ? (
            <p style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>{sendStatus}</p>
          ) : null}
          {!extId ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
              เปิดหน้านี้จาก Extension Settings เพื่อเปิดใช้งานการส่งอัตโนมัติ / Open from the
              Chrome extension Settings to enable direct send.
            </p>
          ) : null}
        </div>
      ) : (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ชื่อ (เช่น My laptop) / Label"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="btn-primary"
          >
            {busy ? '...' : 'สร้าง Token ใหม่ / Generate new token'}
          </button>
        </div>
      )}

      <table style={{ width: '100%', marginTop: 20, borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: '8px 6px' }}>
              ชื่อ <span className="label-en">/ Label</span>
            </th>
            <th style={{ padding: '8px 6px' }}>
              สร้างเมื่อ <span className="label-en">/ Created</span>
            </th>
            <th style={{ padding: '8px 6px' }}>
              ใช้ล่าสุด <span className="label-en">/ Last used</span>
            </th>
            <th style={{ padding: '8px 6px' }}></th>
          </tr>
        </thead>
        <tbody>
          {tokens.length === 0 ? (
            <tr>
              <td colSpan={4} className="muted" style={{ padding: 12, textAlign: 'center' }}>
                ยังไม่มี token / No tokens yet.
              </td>
            </tr>
          ) : (
            tokens.map((t) => (
              <tr
                key={t.id}
                style={{
                  borderBottom: '1px solid var(--border)',
                  opacity: t.revoked ? 0.5 : 1,
                }}
              >
                <td style={{ padding: '10px 6px', fontWeight: 600 }}>
                  {t.label}
                  {t.revoked ? (
                    <span style={{ color: 'crimson', marginLeft: 8, fontSize: 11 }}>
                      ยกเลิกแล้ว
                    </span>
                  ) : null}
                </td>
                <td style={{ padding: '10px 6px', color: 'var(--text-muted)' }}>
                  {new Date(t.createdAt).toLocaleString()}
                </td>
                <td style={{ padding: '10px 6px', color: 'var(--text-muted)' }}>
                  {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : '—'}
                </td>
                <td style={{ padding: '10px 6px', textAlign: 'right' }}>
                  {!t.revoked ? (
                    <button
                      type="button"
                      onClick={() => void revoke(t.id)}
                      disabled={busy}
                      className="btn-secondary"
                      style={{ padding: '6px 12px', fontSize: 12 }}
                    >
                      ยกเลิก / Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  )
}
