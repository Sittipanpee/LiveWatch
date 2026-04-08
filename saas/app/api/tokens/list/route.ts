import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface TokenListItem {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string | null
  revoked: boolean
}

interface TokenRow {
  id: string
  label: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export async function GET(_request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const { data, error } = await service
    .from('api_tokens')
    .select('id, label, created_at, last_used_at, revoked_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .returns<TokenRow[]>()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const tokens: TokenListItem[] = (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revoked: row.revoked_at != null,
  }))

  return NextResponse.json({ tokens })
}
