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

  // Retry up to 5 times to avoid pairing_code unique collision (very unlikely).
  for (let attempts = 0; attempts < 5; attempts++) {
    const code = generatePairingCode()
    const expires = pairingCodeExpiresAt().toISOString()

    // Try to update an existing row first — this guarantees line_user_id is
    // explicitly cleared (upsert may skip null columns in the conflict UPDATE).
    const { data: updated, error: updateError } = await service
      .from('users')
      .update({
        pairing_code: code,
        pairing_code_expires_at: expires,
        line_user_id: null,
        paired_at: null,
      })
      .eq('id', user.id)
      .select('id')

    if (updateError) {
      if (String(updateError.message).toLowerCase().includes('duplicate')) continue
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    if (updated && updated.length > 0) {
      return NextResponse.json({ pairingCode: code, pairingCodeExpiresAt: expires })
    }

    // No existing row — insert for first-time users.
    const { error: insertError } = await service
      .from('users')
      .insert({
        id: user.id,
        email: user.email ?? '',
        pairing_code: code,
        pairing_code_expires_at: expires,
      })

    if (!insertError) {
      return NextResponse.json({ pairingCode: code, pairingCodeExpiresAt: expires })
    }
    if (!String(insertError.message).toLowerCase().includes('duplicate')) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Failed to allocate pairing code' }, { status: 500 })
}
