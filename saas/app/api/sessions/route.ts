import { authenticateAnyRequest } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface CreateSessionBody {
  started_at: string
  tab_url?: string
}

interface SessionRow {
  id: string
  started_at: string
  ended_at: string | null
  duration_mins: number | null
  tab_url: string | null
}

interface AnalysisCountRow {
  session_id: string | null
  alert_flag: boolean
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateAnyRequest(request)
  if (!auth) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: CreateSessionBody
  try {
    body = (await request.json()) as CreateSessionBody
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!body.started_at || typeof body.started_at !== 'string') {
    return Response.json({ error: 'started_at is required' }, { status: 400 })
  }

  const service = createServiceClient()
  const { data, error } = await service
    .from('user_sessions')
    .insert({
      user_id: auth.userId,
      started_at: body.started_at,
      tab_url: body.tab_url ?? null,
    })
    .select('id, started_at, tab_url')
    .single<{ id: string; started_at: string; tab_url: string | null }>()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data, { status: 201 })
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateAnyRequest(request)
  if (!auth) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()

  const { data: sessions, error: sessionsError } = await service
    .from('user_sessions')
    .select('id, started_at, ended_at, duration_mins, tab_url')
    .eq('user_id', auth.userId)
    .order('started_at', { ascending: false })
    .limit(50)
    .returns<SessionRow[]>()

  if (sessionsError) {
    return Response.json({ error: sessionsError.message }, { status: 500 })
  }

  if (!sessions || sessions.length === 0) {
    return Response.json({ sessions: [] })
  }

  const sessionIds = sessions.map((s) => s.id)

  const { data: analysisCounts, error: analysisError } = await service
    .from('user_analysis_logs')
    .select('session_id, alert_flag')
    .eq('user_id', auth.userId)
    .in('session_id', sessionIds)
    .returns<AnalysisCountRow[]>()

  if (analysisError) {
    return Response.json({ error: analysisError.message }, { status: 500 })
  }

  const rows = analysisCounts ?? []

  const result = sessions.map((session) => {
    const logs = rows.filter((r) => r.session_id === session.id)
    return {
      id: session.id,
      started_at: session.started_at,
      ended_at: session.ended_at,
      duration_mins: session.duration_mins,
      tab_url: session.tab_url,
      burst_count: logs.length,
      alert_count: logs.filter((r) => r.alert_flag).length,
    }
  })

  return Response.json({ sessions: result })
}
