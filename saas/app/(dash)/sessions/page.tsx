'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useLocale } from '@/components/LocaleProvider'

interface SessionRow {
  id: string
  started_at: string
  ended_at: string | null
  duration_mins: number | null
  tab_url: string | null
  alert_count: number
  burst_count: number
}

interface SessionsResponse {
  sessions: SessionRow[]
}

function formatDate(iso: string, locale: string): string {
  if (locale === 'th') {
    return new Date(iso).toLocaleString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return new Date(iso).toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function truncateUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.slice(0, 30)
    return `${u.hostname}${path}${u.pathname.length > 30 ? '…' : ''}`
  } catch {
    return url.length > 40 ? `${url.slice(0, 40)}…` : url
  }
}

export default function SessionsPage() {
  const { locale, t } = useLocale()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/sessions', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as SessionsResponse
        setSessions(data.sessions)
      })
      .catch(() => setError(t('sessions', 'loadError')))
      .finally(() => setLoading(false))
  }, [t])

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('sessions', 'title')}</h1>
          <p className="text-gray-500 mt-1 text-sm">
            {locale === 'th' ? 'บันทึกการวิเคราะห์ TikTok Live ทั้งหมด' : 'All recorded TikTok Live analysis sessions'}
          </p>
        </div>
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand transition">
          ← {t('nav', 'dashboard')}
        </Link>
      </div>

      {loading && (
        <Card>
          <p className="text-gray-500">{t('common', 'loading')}</p>
        </Card>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50">
          <p className="text-red-700">{error}</p>
        </Card>
      )}

      {!loading && !error && sessions.length === 0 && (
        <Card className="text-center py-12">
          <div className="text-4xl mb-4">📺</div>
          <p className="text-lg font-semibold text-gray-700">{t('sessions', 'empty')}</p>
          <p className="text-sm text-gray-500 mt-2">{t('sessions', 'emptyHint')}</p>
        </Card>
      )}

      {!loading && !error && sessions.length > 0 && (
        <div className="space-y-3">
          {sessions.map((session) => (
            <Card key={session.id} className="hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-800">
                      {formatDate(session.started_at, locale)}
                    </span>
                    {session.alert_count > 0 && (
                      <Badge variant="danger">
                        ⚠️ {session.alert_count} {t('sessions', 'alerts')}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-sm text-gray-500 flex-wrap">
                    {session.duration_mins != null && (
                      <span>
                        ⏱ {session.duration_mins} {t('sessions', 'mins')}
                      </span>
                    )}
                    <span>
                      📊 {session.burst_count} {t('sessions', 'bursts')}
                    </span>
                    {session.tab_url ? (
                      <span className="truncate max-w-xs text-xs text-gray-400">
                        🔗 {truncateUrl(session.tab_url)}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">{t('sessions', 'noUrl')}</span>
                    )}
                  </div>
                </div>

                <Link
                  href={`/sessions/${session.id}`}
                  className="shrink-0 text-sm px-4 py-2 rounded-xl bg-accent text-white hover:bg-accent-dark transition font-semibold"
                >
                  {t('sessions', 'view')}
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
