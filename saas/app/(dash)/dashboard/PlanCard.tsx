import { Card, Badge } from '@/components/ui'
import { getTierLimits, type UserTier } from '@/lib/tiers'

const TIER_LABEL: Record<UserTier, string> = {
  gold: 'โกลด์',
  platinum: 'แพลตทินัม',
  diamond: 'ไดมอนด์',
}

interface Props {
  tier: UserTier
  expiresAt: string | null
}

export default function PlanCard({ tier, expiresAt }: Props) {
  const limits = getTierLimits(tier)
  const label = TIER_LABEL[tier]
  return (
    <Card>
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
            แพลนของคุณ
          </p>
          <div className="flex items-center gap-2 mt-1">
            <h2 className="text-2xl font-bold">{label}</h2>
            <Badge variant={tier}>{tier.toUpperCase()}</Badge>
          </div>
        </div>
      </div>
      <ul className="space-y-2 text-sm text-gray-700">
        <li className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-brand" />
          สูงสุด {limits.maxCapturesPerHour} ครั้งต่อชั่วโมง
        </li>
        <li className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-brand" />
          ช่วงเวลาขั้นต่ำ {limits.minIntervalMinutes} นาที
        </li>
      </ul>
      {expiresAt ? (
        <p className="text-xs text-gray-500 mt-4">
          ต่ออายุ {new Date(expiresAt).toLocaleDateString('th-TH')}
        </p>
      ) : null}
    </Card>
  )
}
