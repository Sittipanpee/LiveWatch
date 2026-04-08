import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { generateApiToken } from '@/lib/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface GenerateBody {
  label?: string
}

interface GenerateResponse {
  token: string
  label: string
  createdAt: string
  warning: string
}

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: GenerateBody = {}
  try {
    const text = await request.text()
    if (text) body = JSON.parse(text) as GenerateBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const label =
    typeof body.label === 'string' && body.label.trim().length > 0
      ? body.label.trim().slice(0, 80)
      : 'Chrome Extension'

  const { plaintext, hash } = generateApiToken()
  const service = createServiceClient()

  const { data, error } = await service
    .from('api_tokens')
    .insert({ user_id: user.id, token_hash: hash, label })
    .select('created_at')
    .single<{ created_at: string }>()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to create token' },
      { status: 500 },
    )
  }

  const response: GenerateResponse = {
    token: plaintext,
    label,
    createdAt: data.created_at,
    warning: 'Save this token now — it will not be shown again.',
  }
  return NextResponse.json(response, { status: 201 })
}
