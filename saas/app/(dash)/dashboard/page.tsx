import { createClient } from '@/lib/supabase/server'
import { getTierLimits, type UserTier } from '@/lib/tiers'
import PairingSection from './PairingSection'

interface TierRow {
  tier: UserTier | null
  tier_expires_at: string | null
}

const TIER_COLORS: Record<UserTier, string> = {
  gold: '#D4AF37',
  platinum: '#B8B8B8',
  diamond: '#4FC3F7',
}

async function loadTier(): Promise<{ tier: UserTier; expiresAt: string | null }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { tier: 'gold', expiresAt: null }
  }

  const { data, error } = await supabase
    .from('users')
    .select('tier, tier_expires_at')
    .eq('id', user.id)
    .maybeSingle<TierRow>()

  if (error || !data || !data.tier) {
    return { tier: 'gold', expiresAt: null }
  }

  const expired =
    data.tier_expires_at != null && new Date(data.tier_expires_at).getTime() < Date.now()
  if (expired) {
    return { tier: 'gold', expiresAt: null }
  }

  return { tier: data.tier, expiresAt: data.tier_expires_at }
}

export default async function DashboardPage() {
  const { tier, expiresAt } = await loadTier()
  const limits = getTierLimits(tier)
  const color = TIER_COLORS[tier]

  return (
    <main style={{ maxWidth: 640, margin: '40px auto', padding: 24 }}>
      <h1>Dashboard</h1>

      <section
        style={{
          marginTop: 24,
          padding: 16,
          border: `2px solid ${color}`,
          borderRadius: 8,
        }}
      >
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          Subscription
          <span
            style={{
              background: color,
              color: '#000',
              padding: '4px 12px',
              borderRadius: 999,
              fontSize: 14,
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            {tier}
          </span>
        </h2>
        <ul style={{ marginTop: 12, paddingLeft: 20 }}>
          <li>Max captures per hour: {limits.maxCapturesPerHour}</li>
          <li>Min interval: {limits.minIntervalMinutes} minutes</li>
        </ul>
        {expiresAt ? (
          <p style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
            Renews/expires {new Date(expiresAt).toLocaleString()}
          </p>
        ) : null}
      </section>

      <PairingSection />
    </main>
  )
}
