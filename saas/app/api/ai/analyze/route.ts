import { authenticateRequest } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { getTierLimits, type UserTier } from '@/lib/tiers'
import { analyzeFrames, type AnalysisFrame, type AnalysisResult } from '@/lib/ai'

export const runtime = 'nodejs'
export const maxDuration = 60

interface AnalyzeRequestBody {
  frames: AnalysisFrame[]
}

function isValidFrame(value: unknown): value is AnalysisFrame {
  if (!value || typeof value !== 'object') return false
  const b64 = (value as { base64?: unknown }).base64
  return typeof b64 === 'string' && b64.length >= 100 && b64.length <= 3_000_000
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: AnalyzeRequestBody
  try {
    body = (await request.json()) as AnalyzeRequestBody
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!Array.isArray(body.frames) || body.frames.length === 0 || body.frames.length > 5) {
    return Response.json({ error: 'frames must be 1-5 items' }, { status: 400 })
  }
  for (const f of body.frames) {
    if (!isValidFrame(f)) {
      return Response.json({ error: 'invalid frame payload' }, { status: 400 })
    }
  }

  const service = createServiceClient()
  const { data: userRow } = await service
    .from('users')
    .select('tier')
    .eq('id', auth.userId)
    .maybeSingle<{ tier: UserTier }>()

  const tier: UserTier = userRow?.tier ?? 'gold'
  const limits = getTierLimits(tier)

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: recentCount } = await service
    .from('ai_analysis_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', auth.userId)
    .gte('created_at', oneHourAgo)

  if ((recentCount ?? 0) >= limits.maxCapturesPerHour) {
    return Response.json(
      { error: 'tier rate limit exceeded', tier, limit: limits.maxCapturesPerHour },
      { status: 429 },
    )
  }

  let result: AnalysisResult
  try {
    result = await analyzeFrames(body.frames)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[api/ai/analyze] pollinations error:', msg)
    return Response.json({ error: 'ai provider error' }, { status: 502 })
  }

  await service.from('ai_analysis_logs').insert({ user_id: auth.userId })

  return Response.json(result)
}
