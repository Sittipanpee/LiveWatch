import { createClient } from '@/lib/supabase/server'
import { getTierLimits, type UserTier } from '@/lib/tiers'

interface TierResponse {
  tier: UserTier
  maxCapturesPerHour: number
  minIntervalMinutes: number
  tierExpiresAt: string | null
}

interface TierRow {
  tier: UserTier | null
  tier_expires_at: string | null
}

export async function GET(_request: Request): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  const { data, error } = await supabase
    .from('users')
    .select('tier, tier_expires_at')
    .eq('id', user.id)
    .maybeSingle<TierRow>()

  const now = Date.now()
  let tier: UserTier = 'gold'
  let tierExpiresAt: string | null = null

  if (!error && data && data.tier) {
    const expired =
      data.tier_expires_at != null && new Date(data.tier_expires_at).getTime() < now
    if (!expired) {
      tier = data.tier
      tierExpiresAt = data.tier_expires_at
    }
  }

  const limits = getTierLimits(tier)
  const body: TierResponse = {
    tier,
    maxCapturesPerHour: limits.maxCapturesPerHour,
    minIntervalMinutes: limits.minIntervalMinutes,
    tierExpiresAt,
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
