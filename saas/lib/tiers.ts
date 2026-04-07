export type UserTier = 'gold' | 'platinum' | 'diamond'

export interface TierLimits {
  maxCapturesPerHour: number
  minIntervalMinutes: number
}

export const TIER_LIMITS: Record<UserTier, TierLimits> = {
  gold: { maxCapturesPerHour: 3, minIntervalMinutes: 20 },
  platinum: { maxCapturesPerHour: 6, minIntervalMinutes: 10 },
  diamond: { maxCapturesPerHour: 12, minIntervalMinutes: 5 },
}

export function getTierLimits(tier: UserTier): TierLimits {
  return TIER_LIMITS[tier]
}
