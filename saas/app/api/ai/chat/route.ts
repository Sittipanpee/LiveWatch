import { authenticateRequest } from '@/lib/auth'

export const runtime = 'nodejs'
export const maxDuration = 30

const POLLINATIONS_TEXT_URL = 'https://text.pollinations.ai/openai'
const POLLINATIONS_TEXT_MODEL = 'openai-fast'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatRequestBody {
  messages: ChatMessage[]
  temperature?: number
}

interface PollinationsChoice {
  message?: { content?: string }
  text?: string
}

interface PollinationsResponse {
  choices?: PollinationsChoice[]
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: ChatRequestBody
  try {
    body = (await request.json()) as ChatRequestBody
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 10) {
    return Response.json({ error: 'messages must be 1-10 items' }, { status: 400 })
  }

  for (const msg of body.messages) {
    if (!msg.role || !msg.content || typeof msg.content !== 'string') {
      return Response.json({ error: 'invalid message format' }, { status: 400 })
    }
  }

  const apiKey = process.env.POLLINATIONS_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'ai provider not configured' }, { status: 502 })
  }

  try {
    const response = await fetch(POLLINATIONS_TEXT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: POLLINATIONS_TEXT_MODEL,
        messages: body.messages,
        temperature: body.temperature ?? 0,
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => String(response.status))
      console.error('[api/ai/chat] pollinations error:', response.status, detail.slice(0, 200))
      return Response.json({ error: 'ai provider error' }, { status: 502 })
    }

    const json = (await response.json()) as PollinationsResponse
    const firstChoice = json.choices?.[0]
    const content = firstChoice?.message?.content ?? firstChoice?.text ?? ''

    return Response.json({ content })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[api/ai/chat] error:', msg)
    return Response.json({ error: 'ai provider error' }, { status: 502 })
  }
}
