'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useLocale } from '@/components/LocaleProvider'

interface SessionInfo {
  id: string
  started_at: string
  ended_at: string | null
  duration_mins: number | null
  tab_url: string | null
}

interface AnalysisFrame {
  id: string
  captured_at: string
  phone_detected: boolean
  eye_contact_score: number
  smile_score: number
  product_presenting: boolean
  presenter_visible: boolean
  activity_summary: string | null
  alert_flag: boolean
  thumbnail_url: string | null
}

interface SessionDetailResponse {
  session: SessionInfo
  analysis: AnalysisFrame[]
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

function eyeContactColor(score: number): string {
  if (score >= 60) return 'text-green-600 font-semibold'
  if (score >= 30) return 'text-amber-600 font-semibold'
  return 'text-red-600 font-semibold'
}

function average(frames: AnalysisFrame[], key: 'eye_contact_score' | 'smile_score'): number {
  if (frames.length === 0) return 0
  const sum = frames.reduce((acc, f) => acc + f[key], 0)
  return Math.round(sum / frames.length)
}

interface StatCardProps {
  label: string
  value: string | number
  colorClass?: string
}

function StatCard({ label, value, colorClass }: StatCardProps) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-center">
      <div className={`text-2xl font-bold ${colorClass ?? 'text-gray-800'}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

export default function SessionDetailPage() {
  const params = useParams()
  const id = params.id as string
  const { locale, t } = useLocale()

  const [data, setData] = useState<SessionDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/sessions/${id}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as SessionDetailResponse
        const sorted = [...json.analysis].sort(
          (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime(),
        )
        setData({ ...json, analysis: sorted })
      })
      .catch(() => setError(t('sessions', 'loadError')))
      .finally(() => setLoading(false))
  }, [id, t])

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/sessions" className="text-sm text-gray-500 hover:text-brand transition">
          {t('sessions', 'back')}
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

      {!loading && !error && data && (
        <>
          {/* Session header */}
          <Card>
            <h1 className="text-2xl font-bold mb-4">{t('sessions', 'detailTitle')}</h1>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-gray-400 text-xs mb-1">{t('sessions', 'started')}</p>
                <p className="font-medium">{formatDate(data.session.started_at, locale)}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">{t('sessions', 'ended')}</p>
                <p className="font-medium">
                  {data.session.ended_at
                    ? formatDate(data.session.ended_at, locale)
                    : <span className="text-green-600">{t('sessions', 'ongoing')}</span>}
                </p>
              </div>
              {data.session.duration_mins != null && (
                <div>
                  <p className="text-gray-400 text-xs mb-1">{t('sessions', 'duration')}</p>
                  <p className="font-medium">
                    {data.session.duration_mins} {t('sessions', 'mins')}
                  </p>
                </div>
              )}
              {data.session.tab_url && (
                <div className="col-span-2 md:col-span-1">
                  <p className="text-gray-400 text-xs mb-1">URL</p>
                  <a
                    href={data.session.tab_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand hover:underline truncate block text-xs"
                  >
                    {data.session.tab_url}
                  </a>
                </div>
              )}
            </div>
          </Card>

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label={t('sessions', 'totalBursts')} value={data.analysis.length} />
            <StatCard
              label={t('sessions', 'totalAlerts')}
              value={data.analysis.filter((f) => f.alert_flag).length}
              colorClass={
                data.analysis.filter((f) => f.alert_flag).length > 0
                  ? 'text-red-600 font-bold'
                  : 'text-gray-800'
              }
            />
            <StatCard
              label={t('sessions', 'avgEyeContact')}
              value={`${average(data.analysis, 'eye_contact_score')}%`}
              colorClass={eyeContactColor(average(data.analysis, 'eye_contact_score'))}
            />
            <StatCard
              label={t('sessions', 'avgSmile')}
              value={`${average(data.analysis, 'smile_score')}%`}
            />
          </div>

          {/* Analysis gallery */}
          {data.analysis.length === 0 ? (
            <Card className="text-center py-10">
              <p className="text-gray-500">{t('sessions', 'noFrames')}</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.analysis.map((frame) => (
                <Card key={frame.id} className="space-y-3">
                  {frame.thumbnail_url && (
                    <img
                      src={frame.thumbnail_url}
                      alt={`Frame at ${frame.captured_at}`}
                      className="w-full max-h-32 object-cover rounded-lg bg-gray-100"
                    />
                  )}

                  <p className="text-xs text-gray-400">{formatDate(frame.captured_at, locale)}</p>

                  <div className="flex items-center gap-3 text-sm">
                    <span>
                      <span className="text-gray-400 text-xs">{t('sessions', 'eyeContact')} </span>
                      <span className={eyeContactColor(frame.eye_contact_score)}>
                        {frame.eye_contact_score}%
                      </span>
                    </span>
                    <span>
                      <span className="text-gray-400 text-xs">{t('sessions', 'smile')} </span>
                      <span className="font-semibold text-gray-700">{frame.smile_score}%</span>
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {frame.alert_flag && (
                      <Badge variant="danger">⚠️ {t('sessions', 'alert')}</Badge>
                    )}
                    {frame.phone_detected && (
                      <Badge variant="warning">📱 {t('sessions', 'phone')}</Badge>
                    )}
                    {frame.product_presenting && (
                      <Badge variant="success">🎯 {t('sessions', 'product')}</Badge>
                    )}
                  </div>

                  {frame.activity_summary && (
                    <p className="text-xs text-gray-600 leading-relaxed">{frame.activity_summary}</p>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
