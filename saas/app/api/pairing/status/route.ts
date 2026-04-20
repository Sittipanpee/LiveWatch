import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { authenticateRequest } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PairingStatusResponse {
  pairingCode: string | null
  pairingCodeExpiresAt: string | null
  linePaired: boolean
  pairedAt: string | null
}

export async function GET(request: Request): Promise<Response> {
  // Support both token auth (extension) and cookie auth (dashboard)
  let userId: string
  const tokenAuth = await authenticateRequest(request)
  if (tokenAuth) {
    userId = tokenAuth.userId
  } else {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
    userId = user.id
  }

  const service = createServiceClient()
  const { data, error } = await service
    .from('users')
    .select('pairing_code, pairing_code_expires_at, line_user_id, paired_at')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const row = data as
    | {
        pairing_code: string | null
        pairing_code_expires_at: string | null
        line_user_id: string | null
        paired_at: string | null
      }
    | null

  const body: PairingStatusResponse = {
    pairingCode: row?.pairing_code ?? null,
    pairingCodeExpiresAt: row?.pairing_code_expires_at ?? null,
    linePaired: Boolean(row?.line_user_id),
    pairedAt: row?.paired_at ?? null,
  }
  return NextResponse.json(body)
}
