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
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return new Date(iso).toLocaleString('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function RecentSessions() {
  const { locale, t } = useLocale()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/sessions', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return
        const data = (await res.json()) as SessionsResponse
        setSessions(data.sessions.slice(0, 3))
      })
      .catch(() => {
        // silently fail — this is a non-critical dashboard widget
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">
          {t('sessions', 'recentSessions')}
          <span className="text-sm font-normal text-gray-400 ml-2">/ Recent Sessions</span>
        </h2>
        <Link
          href="/sessions"
          className="text-sm text-brand hover:underline font-medium"
        >
          {t('sessions', 'viewAll')}
        </Link>
      </div>

      {loading && <p className="text-gray-500 text-sm">{t('common', 'loading')}</p>}

      {!loading && sessions.length === 0 && (
        <div className="text-center py-8">
          <p className="text-gray-400 text-sm">{t('sessions', 'empty')}</p>
          <p className="text-gray-300 text-xs mt-1">{t('sessions', 'emptyHint')}</p>
        </div>
      )}

      {!loading && sessions.length > 0 && (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-700">
                    {formatDate(session.started_at, locale)}
                  </span>
                  {session.alert_count > 0 && (
                    <Badge variant="danger">⚠️ {session.alert_count}</Badge>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {session.burst_count} {t('sessions', 'bursts')}
                  {session.duration_mins != null
                    ? ` · ${session.duration_mins} ${t('sessions', 'mins')}`
                    : ''}
                </p>
              </div>
              <Link
                href={`/sessions/${session.id}`}
                className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-brand hover:text-brand transition"
              >
                {t('sessions', 'view')}
              </Link>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
