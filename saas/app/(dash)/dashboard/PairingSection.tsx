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
  const [loaded, setLoaded] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<boolean>(false)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const res = await fetch('/api/pairing/status', { cache: 'no-store' })
      if (!res.ok) {
        setError('โหลดสถานะไม่สำเร็จ / Failed to load pairing status')
        return
      }
      setStatus((await res.json()) as PairingStatus)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function regenerate(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/pairing/regenerate', { method: 'POST' })
      if (!res.ok) {
        setError('สร้างรหัสไม่สำเร็จ / Failed to regenerate code')
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <section className="card">
        <h2 style={{ marginTop: 0 }}>
          เชื่อมต่อ LINE <span className="label-en">/ Connect LINE</span>
        </h2>
        <p className="muted">กำลังโหลด... / Loading...</p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>
        เชื่อมต่อ LINE <span className="label-en">/ Connect LINE</span>
      </h2>
      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

      {/* Step 1: Add LINE bot */}
      <div
        style={{
          textAlign: 'center',
          padding: 20,
          background: '#F7F9FA',
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>ขั้นที่ 1: เพิ่มเพื่อนใน LINE</h3>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          Step 1: Add LiveWatch Bot as friend
        </p>
        <img
          src="https://qr-official.line.me/gs/M_imz5326s_GW.png"
          alt="LINE Bot QR Code"
          style={{ width: 180, height: 180, margin: '0 auto', display: 'block' }}
        />
        <a
          href="https://lin.ee/zieAzkw"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-line"
          style={{ marginTop: 12 }}
        >
          📱 เปิดใน LINE (Add Friend)
        </a>
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          สแกน QR หรือกดปุ่มด้านบน / Scan QR or tap the button
        </p>
      </div>

      {/* Step 2: pairing code */}
      <div>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>ขั้นที่ 2: ส่งรหัสนี้ไปยัง Bot</h3>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          Step 2: Send this code to the bot
        </p>
        {status?.linePaired ? (
          <div
            style={{
              padding: 16,
              background: '#F0F9F4',
              border: '1px solid #06C755',
              borderRadius: 8,
            }}
          >
            <p style={{ margin: 0, color: '#06C755', fontWeight: 'bold' }}>
              ✅ เชื่อมต่อ LINE สำเร็จแล้ว
            </p>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Paired {status.pairedAt ? new Date(status.pairedAt).toLocaleString() : ''}
            </p>
          </div>
        ) : (
          <>
            {status?.pairingCode ? (
              <div
                style={{
                  padding: 16,
                  background: '#FFF9E6',
                  border: '1px dashed #D4AF37',
                  borderRadius: 8,
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 'bold',
                    letterSpacing: 2,
                    fontFamily: 'monospace',
                  }}
                >
                  {status.pairingCode}
                </div>
                <p className="muted" style={{ marginTop: 8 }}>
                  พิมพ์รหัสนี้ใน LINE chat ที่เปิดกับ bot
                </p>
                {status.pairingCodeExpiresAt ? (
                  <p className="muted" style={{ fontSize: 12 }}>
                    หมดอายุ / Expires{' '}
                    {new Date(status.pairingCodeExpiresAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="muted">
                ยังไม่มีรหัส คลิกปุ่มด้านล่างเพื่อสร้าง / No code yet — click below to generate
              </p>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={regenerate}
              disabled={busy}
              style={{ marginTop: 12 }}
            >
              {busy ? 'กำลังสร้าง...' : 'สร้างรหัสใหม่ / Generate new code'}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
