import { NextResponse } from 'next/server'
import { linePush, type LineMessage } from '@/lib/line/client'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SendRequest {
  userId?: string // Supabase users.id
  lineUserId?: string // Direct LINE userId (if already known)
  messages: LineMessage[]
}

/**
 * Server-to-server endpoint for the extension backend to push LINE messages.
 * Auth: shared-secret header `x-livewatch-service-key` matching SUPABASE_SERVICE_ROLE_KEY.
 * (Simple gate for now — replace with a dedicated service token in production.)
 */
export async function POST(request: Request): Promise<Response> {
  const auth = request.headers.get('x-livewatch-service-key')
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!expected || auth !== expected) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let payload: SendRequest
  try {
    payload = (await request.json()) as SendRequest
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  if (!payload.messages || payload.messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 })
  }

  let targetLineUserId: string | null = payload.lineUserId ?? null

  if (!targetLineUserId && payload.userId) {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('users')
      .select('line_user_id')
      .eq('id', payload.userId)
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    targetLineUserId = (data?.line_user_id as string | null | undefined) ?? null
  }

  if (!targetLineUserId) {
    return NextResponse.json({ error: 'no LINE target for user' }, { status: 404 })
  }

  const result = await linePush(targetLineUserId, payload.messages)
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'LINE push failed' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
