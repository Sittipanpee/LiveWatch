import { NextResponse } from 'next/server'
import { verifyLineSignature } from '@/lib/line/verify'
import { lineReply, type LineMessage } from '@/lib/line/client'
import { createServiceClient } from '@/lib/supabase/service'

// Force Node.js runtime — we need node:crypto for HMAC.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface LineSource {
  type: 'user' | 'group' | 'room'
  userId?: string
}

interface LineMessageEvent {
  type: 'message'
  replyToken: string
  source: LineSource
  message: { type: 'text'; text: string } | { type: string }
}

interface LineWebhookBody {
  events: LineMessageEvent[]
}

function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '')
}

async function handleMessageEvent(event: LineMessageEvent): Promise<void> {
  if (event.message.type !== 'text') return
  const userId = event.source.userId
  if (!userId) return

  const text = (event.message as { text: string }).text
  const code = normalizeCode(text)

  // Expect format LW-XXXXXX.
  if (!/^LW-[0-9A-Z]{6}$/.test(code)) {
    await lineReply(event.replyToken, [
      { type: 'text', text: 'ส่งรหัสจับคู่จากแดชบอร์ด (รูปแบบ LW-XXXXXX) นะคะ' },
    ])
    return
  }

  const supabase = createServiceClient()

  // Atomic claim: only succeeds if code matches, not expired, and not yet paired.
  const { data, error } = await supabase
    .from('users')
    .update({ line_user_id: userId, paired_at: new Date().toISOString() })
    .eq('pairing_code', code)
    .is('line_user_id', null)
    .gt('pairing_code_expires_at', new Date().toISOString())
    .select('id')

  const reply: LineMessage[] =
    error || !data || data.length === 0
      ? [{ type: 'text', text: 'รหัสหมดอายุหรือถูกใช้ไปแล้ว โปรดสร้างใหม่จากแดชบอร์ด' }]
      : [{ type: 'text', text: 'จับคู่บัญชี LiveWatch สำเร็จแล้ว ✅' }]

  await lineReply(event.replyToken, reply)
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text()
  const signature = request.headers.get('x-line-signature') ?? ''
  const secret = process.env.LINE_CHANNEL_SECRET
  if (!secret) {
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  if (!verifyLineSignature(raw, signature, secret)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: LineWebhookBody
  try {
    body = JSON.parse(raw) as LineWebhookBody
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  for (const event of body.events ?? []) {
    if (event.type === 'message') {
      try {
        await handleMessageEvent(event)
      } catch (err) {
        console.error('[line/webhook] handler error', err)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
