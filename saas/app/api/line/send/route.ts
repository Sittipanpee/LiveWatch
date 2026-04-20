import { NextResponse } from 'next/server'
import { linePush, type LineMessage } from '@/lib/line/client'
import { authenticateRequest } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SendRequest {
  text?: string
  imageUrl?: string
}

/**
 * Push a LINE message to the authenticated user's paired LINE account.
 * Auth: `Authorization: Bearer <api token>` from /api/tokens/generate.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  if (!auth.lineUserId) {
    return NextResponse.json({ error: 'LINE not paired' }, { status: 400 })
  }

  let payload: SendRequest
  try {
    payload = (await request.json()) as SendRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const text = typeof payload.text === 'string' ? payload.text.trim() : ''
  if (!text) {
    return NextResponse.json({ error: 'text required' }, { status: 400 })
  }

  const messages: LineMessage[] = []

  // If imageUrl is provided, send image first then text
  const imageUrl = typeof payload.imageUrl === 'string' ? payload.imageUrl.trim() : ''
  if (imageUrl) {
    messages.push({
      type: 'image',
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    })
  }

  messages.push({ type: 'text', text })

  const result = await linePush(auth.lineUserId, messages)
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'LINE push failed' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
