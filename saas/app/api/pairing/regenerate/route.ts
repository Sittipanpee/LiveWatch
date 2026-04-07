import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { generatePairingCode, pairingCodeExpiresAt } from '@/lib/pairing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const service = createServiceClient()

  // Upsert row keyed on auth user id. Retry on unique collision (extremely unlikely).
  let attempts = 0
  while (attempts < 5) {
    attempts++
    const code = generatePairingCode()
    const expires = pairingCodeExpiresAt().toISOString()
    const { error } = await service
      .from('users')
      .upsert(
        {
          id: user.id,
          email: user.email ?? '',
          pairing_code: code,
          pairing_code_expires_at: expires,
          line_user_id: null,
          paired_at: null,
        },
        { onConflict: 'id' },
      )
    if (!error) {
      return NextResponse.json({ pairingCode: code, pairingCodeExpiresAt: expires })
    }
    // Unique violation on pairing_code — generate another.
    if (!String(error.message).toLowerCase().includes('duplicate')) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Failed to allocate pairing code' }, { status: 500 })
}
