import { Check, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export type StepStatus = 'done' | 'active' | 'locked'

export interface StepCardProps {
  number: number
  title: string
  description?: string
  status: StepStatus
  cta?: ReactNode
}

export function StepCard({ number, title, description, status, cta }: StepCardProps) {
  const isDone = status === 'done'
  const isActive = status === 'active'
  const isLocked = status === 'locked'

  return (
    <div
      className={cn(
        'rounded-2xl border p-5 transition-all',
        isDone && 'border-green-200 bg-green-50/40',
        isActive && 'border-accent bg-white shadow-sm ring-2 ring-accent/20',
        isLocked && 'border-gray-200 bg-gray-50 opacity-60',
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-semibold',
            isDone && 'bg-green-500 text-white',
            isActive && 'bg-accent text-white',
            isLocked && 'bg-gray-200 text-gray-500',
          )}
        >
          {isDone ? <Check className="w-5 h-5" /> : isLocked ? <Lock className="w-4 h-4" /> : number}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={cn('font-semibold', isDone && 'text-gray-600')}>{title}</h3>
          {description && isActive ? <p className="text-sm text-gray-600 mt-1">{description}</p> : null}
          {isActive && cta ? <div className="mt-4">{cta}</div> : null}
        </div>
      </div>
    </div>
  )
}
