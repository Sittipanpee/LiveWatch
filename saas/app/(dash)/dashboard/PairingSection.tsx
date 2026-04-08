'use client'
import { useCallback, useEffect, useState } from 'react'
import { Card, Button, Alert } from '@/components/ui'

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
        setError('โหลดสถานะไม่สำเร็จ')
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
        setError('สร้างรหัสไม่สำเร็จ')
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <Card>
        <h2 className="text-xl font-semibold mb-2">
          เชื่อม LINE <span className="text-sm font-normal text-gray-400">/ Connect LINE</span>
        </h2>
        <p className="text-gray-500">กำลังโหลด...</p>
      </Card>
    )
  }

  return (
    <Card>
      <h2 className="text-xl font-semibold mb-4">
        เชื่อม LINE <span className="text-sm font-normal text-gray-400">/ Connect LINE</span>
      </h2>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <div className="rounded-2xl bg-gray-50 p-6 text-center mb-4">
        <h3 className="font-semibold">ขั้นที่ 1: เพิ่มเพื่อนใน LINE</h3>
        <p className="text-xs text-gray-500 mb-4">Add LiveWatch Bot as friend</p>
        <img
          src="https://qr-official.line.me/gs/M_imz5326s_GW.png"
          alt="LINE Bot QR Code"
          className="w-44 h-44 mx-auto mb-4 rounded-xl bg-white p-2"
        />
        <a
          href="https://lin.ee/zieAzkw"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#06C755] text-white font-semibold hover:bg-[#05a649] transition"
        >
          📱 เปิดใน LINE
        </a>
        <p className="text-xs text-gray-400 mt-3">สแกน QR หรือกดปุ่มด้านบน</p>
      </div>

      <div>
        <h3 className="font-semibold mb-2">ขั้นที่ 2: ส่งรหัสนี้ไปยัง Bot</h3>
        {status?.linePaired ? (
          <Alert variant="success">
            <div>
              <p className="font-semibold">เชื่อมต่อ LINE สำเร็จแล้ว</p>
              {status.pairedAt ? (
                <p className="text-xs mt-1 opacity-80">
                  Paired {new Date(status.pairedAt).toLocaleString('th-TH')}
                </p>
              ) : null}
            </div>
          </Alert>
        ) : (
          <>
            {status?.pairingCode ? (
              <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 p-6 text-center">
                <div className="text-3xl font-bold font-mono tracking-widest">
                  {status.pairingCode}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  พิมพ์รหัสนี้ใน LINE chat ที่เปิดกับ bot
                </p>
                {status.pairingCodeExpiresAt ? (
                  <p className="text-xs text-gray-400 mt-1">
                    หมดอายุ {new Date(status.pairingCodeExpiresAt).toLocaleString('th-TH')}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-gray-500">ยังไม่มีรหัส — คลิกปุ่มด้านล่างเพื่อสร้าง</p>
            )}
            <Button variant="secondary" onClick={regenerate} disabled={busy} className="mt-4">
              {busy ? 'กำลังสร้าง...' : 'สร้างรหัสใหม่'}
            </Button>
          </>
        )}
      </div>
    </Card>
  )
}
