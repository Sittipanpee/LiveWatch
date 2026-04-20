import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { authenticateRequest } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
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
  const { error } = await service
    .from('users')
    .update({ line_user_id: null, paired_at: null })
    .eq('id', userId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, message: 'LINE unpaired' })
}
