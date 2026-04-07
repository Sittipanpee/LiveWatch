const LINE_API = 'https://api.line.me/v2/bot'

export type LineTextMessage = { type: 'text'; text: string }
export type LineMessage = LineTextMessage

export interface LineApiResult {
  ok: boolean
  status: number
  error?: string
}

function authHeaders(): HeadersInit {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN not set')
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

export async function linePush(to: string, messages: LineMessage[]): Promise<LineApiResult> {
  const res = await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ to, messages }),
  })
  if (!res.ok) {
    return { ok: false, status: res.status, error: await res.text() }
  }
  return { ok: true, status: res.status }
}

export async function lineReply(
  replyToken: string,
  messages: LineMessage[],
): Promise<LineApiResult> {
  const res = await fetch(`${LINE_API}/message/reply`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ replyToken, messages }),
  })
  if (!res.ok) {
    return { ok: false, status: res.status, error: await res.text() }
  }
  return { ok: true, status: res.status }
}
