'use client'
import { useCallback, useEffect, useState } from 'react'
import { Card, Button, Alert } from '@/components/ui'

export interface TokenRow {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string | null
  revoked: boolean
}

interface GenerateResponse {
  token: string
  label: string
  createdAt: string
  warning?: string
}

interface ListResponse {
  tokens: TokenRow[]
}

interface SendResponse {
  ok?: boolean
  error?: string
}

interface ChromeRuntimeApi {
  runtime?: {
    sendMessage: (
      extId: string,
      msg: { type: string; token: string; apiBase: string },
      callback: (resp: SendResponse | undefined) => void,
    ) => void
  }
}

interface Props {
  initialTokens: TokenRow[]
}

export default function TokensSection({ initialTokens }: Props) {
  const [tokens, setTokens] = useState<TokenRow[]>(initialTokens)
  const [plaintext, setPlaintext] = useState<string | null>(null)
  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [sendStatus, setSendStatus] = useState<string | null>(null)
  const [extId, setExtId] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false)

  useEffect(() => {
    setExtId(sessionStorage.getItem('lw_extId'))
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const res = await fetch('/api/tokens/list', { cache: 'no-store' })
    if (!res.ok) return
    const body = (await res.json()) as ListResponse
    setTokens(body.tokens ?? [])
  }, [])

  async function generate(): Promise<void> {
    setBusy(true)
    setError(null)
    setSendStatus(null)
    try {
      const res = await fetch('/api/tokens/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Chrome Extension' }),
      })
      if (!res.ok) {
        setError('เชื่อมต่อไม่สำเร็จ')
        return
      }
      const data = (await res.json()) as GenerateResponse
      setPlaintext(data.token)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string): Promise<void> {
    if (!confirm('ยกเลิกการเชื่อมต่อนี้?')) return
    setBusy(true)
    try {
      const res = await fetch('/api/tokens/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) await refresh()
    } finally {
      setBusy(false)
    }
  }

  function sendToExtension(token: string): void {
    if (!extId) {
      setSendStatus('❌ เปิดหน้านี้จาก Extension Settings เพื่อส่งอัตโนมัติ')
      return
    }
    const apiBase = window.location.origin
    try {
      const chromeApi = (window as unknown as { chrome?: ChromeRuntimeApi }).chrome
      if (!chromeApi?.runtime?.sendMessage) {
        setSendStatus('❌ ไม่พบ Chrome Extension — กรุณาคัดลอกด้วยมือ')
        return
      }
      chromeApi.runtime.sendMessage(
        extId,
        { type: 'SET_API_TOKEN', token, apiBase },
        (response) => {
          if (response?.ok) {
            setSendStatus('✅ ส่งเข้า Extension สำเร็จ — ปิดหน้านี้และกลับไปที่ Chrome ได้เลย')
          } else {
            setSendStatus(
              `❌ ${response?.error ?? 'ไม่สามารถส่งเข้า Extension'} — กรุณาคัดลอกด้วยมือ`,
            )
          }
        },
      )
    } catch (e) {
      setSendStatus(`❌ ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }

  function copyPlaintext(): void {
    if (!plaintext) return
    void navigator.clipboard.writeText(plaintext)
    setSendStatus('📋 คัดลอกแล้ว')
  }

  const activeCount = tokens.filter((tk) => !tk.revoked).length
  const isConnected = activeCount > 0

  return (
    <Card>
      <h2 className="text-xl font-semibold mb-4">
        เชื่อม Chrome Extension{' '}
        <span className="text-sm font-normal text-gray-400">/ Connect extension</span>
      </h2>

      {isConnected && !plaintext ? (
        <Alert variant="success">
          <div>
            <p className="font-semibold">เชื่อม Extension แล้ว</p>
            <p className="text-xs mt-1">
              คุณสามารถใช้งาน Extension ได้แล้ว ({activeCount} การเชื่อมต่อที่ใช้งานอยู่)
            </p>
          </div>
        </Alert>
      ) : null}

      {!isConnected && !plaintext ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            คลิกปุ่มด้านล่างเพื่อเชื่อม Chrome Extension กับบัญชีของคุณ
          </p>
          <Button variant="primary" size="lg" onClick={generate} disabled={busy}>
            {busy ? 'กำลังเชื่อม...' : '🔗 เชื่อม Chrome Extension'}
          </Button>
          {!extId ? (
            <p className="text-xs text-amber-600">
              ⚠ เปิดหน้านี้จาก Extension Settings เพื่อให้ระบบส่งให้อัตโนมัติ
            </p>
          ) : null}
          {error ? <Alert variant="danger">{error}</Alert> : null}
        </div>
      ) : null}

      {plaintext ? (
        <div className="rounded-2xl border-2 border-accent bg-accent-50 p-5 space-y-3 mt-4">
          <Alert variant="warning">⚠️ บันทึกตอนนี้ — ระบบจะไม่แสดงรหัสนี้อีก</Alert>
          <div className="font-mono text-xs break-all bg-white p-3 rounded-xl border border-gray-200">
            {plaintext}
          </div>
          <div className="flex flex-wrap gap-2">
            {extId ? (
              <Button
                variant="primary"
                onClick={() => sendToExtension(plaintext)}
                className="flex-1 min-w-[200px]"
              >
                📤 ส่งไปยัง Extension
              </Button>
            ) : null}
            <Button variant="secondary" onClick={copyPlaintext}>
              📋 คัดลอก
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPlaintext(null)
                setSendStatus(null)
              }}
            >
              ปิด
            </Button>
          </div>
          {sendStatus ? <p className="text-sm">{sendStatus}</p> : null}
        </div>
      ) : null}

      <div className="mt-6 pt-6 border-t border-gray-200">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-gray-500 hover:text-brand"
        >
          {showAdvanced ? '▼' : '▶'} จัดการแบบขั้นสูง
        </button>
        {showAdvanced ? (
          <div className="mt-4 space-y-2">
            {tokens.length === 0 ? (
              <p className="text-xs text-gray-500">ยังไม่มีการเชื่อมต่อ</p>
            ) : (
              tokens.map((tk) => (
                <div
                  key={tk.id}
                  className="flex items-center justify-between text-sm py-2 border-b border-gray-100 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{tk.label}</div>
                    <div className="text-xs text-gray-500">
                      {tk.revoked ? 'ยกเลิกแล้ว' : 'ใช้งานอยู่'} • สร้างเมื่อ{' '}
                      {new Date(tk.createdAt).toLocaleDateString('th-TH')}
                      {tk.lastUsedAt
                        ? ` • ใช้ล่าสุด ${new Date(tk.lastUsedAt).toLocaleDateString('th-TH')}`
                        : ''}
                    </div>
                  </div>
                  {!tk.revoked ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void revoke(tk.id)}
                      disabled={busy}
                    >
                      ยกเลิก
                    </Button>
                  ) : null}
                </div>
              ))
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={generate}
              disabled={busy}
              className="mt-2"
            >
              สร้างการเชื่อมต่อใหม่
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  )
}
