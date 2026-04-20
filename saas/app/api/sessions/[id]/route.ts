import { authenticateAnyRequest } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PatchSessionBody {
  ended_at: string
  duration_mins?: number
}

interface SessionDetailRow {
  id: string
  started_at: string
  ended_at: string | null
  duration_mins: number | null
  tab_url: string | null
}

interface AnalysisLogRow {
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

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const auth = await authenticateAnyRequest(request)
  if (!auth) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await context.params

  let body: PatchSessionBody
  try {
    body = (await request.json()) as PatchSessionBody
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!body.ended_at || typeof body.ended_at !== 'string') {
    return Response.json({ error: 'ended_at is required' }, { status: 400 })
  }

  const service = createServiceClient()
  const { error } = await service
    .from('user_sessions')
    .update({
      ended_at: body.ended_at,
      ...(body.duration_mins !== undefined && { duration_mins: body.duration_mins }),
    })
    .eq('id', id)
    .eq('user_id', auth.userId)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = await authenticateAnyRequest(request)
  if (!auth) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await context.params
  const service = createServiceClient()

  const { data: session, error: sessionError } = await service
    .from('user_sessions')
    .select('id, started_at, ended_at, duration_mins, tab_url')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .maybeSingle<SessionDetailRow>()

  if (sessionError) {
    return Response.json({ error: sessionError.message }, { status: 500 })
  }
  if (!session) {
    return Response.json({ error: 'not found' }, { status: 404 })
  }

  const { data: analysis, error: analysisError } = await service
    .from('user_analysis_logs')
    .select(
      'id, captured_at, phone_detected, eye_contact_score, smile_score, product_presenting, presenter_visible, activity_summary, alert_flag, thumbnail_url',
    )
    .eq('user_id', auth.userId)
    .eq('session_id', id)
    .order('captured_at', { ascending: true })
    .returns<AnalysisLogRow[]>()

  if (analysisError) {
    return Response.json({ error: analysisError.message }, { status: 500 })
  }

  return Response.json({ session, analysis: analysis ?? [] })
}
