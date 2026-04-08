import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { type UserTier } from '@/lib/tiers'
import PairingSection from './PairingSection'
import TokensSection, { type TokenRow } from './TokensSection'
import OnboardingChecklist, { type ChecklistSteps } from './OnboardingChecklist'
import PlanCard from './PlanCard'

interface ApiTokenDbRow {
  id: string
  label: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

interface UserStatusRow {
  tier: UserTier | null
  tier_expires_at: string | null
  line_user_id: string | null
}

interface UserStatus {
  tier: UserTier
  expiresAt: string | null
  lineConnected: boolean
  hasActiveToken: boolean
}

async function loadUserStatus(userId: string): Promise<UserStatus> {
  const service = createServiceClient()

  const { data: userData } = await service
    .from('users')
    .select('tier, tier_expires_at, line_user_id')
    .eq('id', userId)
    .maybeSingle<UserStatusRow>()

  let tier: UserTier = 'gold'
  let expiresAt: string | null = null
  let lineConnected = false
  if (userData) {
    const expired =
      userData.tier_expires_at != null && new Date(userData.tier_expires_at) < new Date()
    tier = !expired && userData.tier != null ? userData.tier : 'gold'
    expiresAt = userData.tier_expires_at
    lineConnected = userData.line_user_id != null
  }

  const { count } = await service
    .from('api_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('revoked_at', null)

  const hasActiveToken = (count ?? 0) > 0

  return { tier, expiresAt, lineConnected, hasActiveToken }
}

async function loadTokens(userId: string): Promise<TokenRow[]> {
  const service = createServiceClient()
  const { data } = await service
    .from('api_tokens')
    .select('id, label, created_at, last_used_at, revoked_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .returns<ApiTokenDbRow[]>()
  if (!data) return []
  return data.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revoked: r.revoked_at != null,
  }))
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <div className="max-w-xl mx-auto p-8">
        <p>กรุณาเข้าสู่ระบบ</p>
      </div>
    )
  }

  const status = await loadUserStatus(user.id)
  const tokens = await loadTokens(user.id)

  const steps: ChecklistSteps = {
    account: 'done',
    line: status.lineConnected ? 'done' : 'active',
    extension: status.hasActiveToken ? 'done' : status.lineConnected ? 'active' : 'locked',
    live: 'locked',
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">สวัสดี 👋</h1>
        <p className="text-gray-500 mt-1">{user.email}</p>
      </div>

      <OnboardingChecklist steps={steps} />

      <div className="grid md:grid-cols-2 gap-6">
        <PlanCard tier={status.tier} expiresAt={status.expiresAt} />
      </div>

      <PairingSection />
      <TokensSection initialTokens={tokens} />
    </div>
  )
}
