import { authenticateRequest } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface UploadFrameBody {
  base64: string
  session_id?: string
  captured_at: string
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: UploadFrameBody
  try {
    body = (await request.json()) as UploadFrameBody
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  if (typeof body.base64 !== 'string' || body.base64.length < 100 || body.base64.length > 3_000_000) {
    return Response.json({ error: 'base64 must be 100 to 3,000,000 chars' }, { status: 400 })
  }
  if (!body.captured_at || typeof body.captured_at !== 'string') {
    return Response.json({ error: 'captured_at is required' }, { status: 400 })
  }

  const buffer = Buffer.from(body.base64, 'base64')

  const date = new Date(body.captured_at).toISOString().slice(0, 10)
  const time = new Date(body.captured_at).getTime()
  const sessionSegment = body.session_id ?? 'no-session'
  const path = `frames/${date}/${auth.userId}/${sessionSegment}/${time}.jpg`

  const service = createServiceClient()
  const { error: uploadError } = await service.storage
    .from('livewatch-frames')
    .upload(path, buffer, { contentType: 'image/jpeg', upsert: true })

  if (uploadError) {
    return Response.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: urlData } = service.storage.from('livewatch-frames').getPublicUrl(path)

  return Response.json({ url: urlData?.publicUrl ?? null })
}
