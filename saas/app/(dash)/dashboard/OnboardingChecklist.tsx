'use client'
import { StepCard } from '@/components/ui'
import { useT } from '@/components/LocaleProvider'
import type { ReactNode } from 'react'

export type StepStatus = 'done' | 'active' | 'locked'

export interface ChecklistSteps {
  account: StepStatus
  line: StepStatus
  extension: StepStatus
  live: StepStatus
}

interface Props {
  steps: ChecklistSteps
  lineCta?: ReactNode
  extensionCta?: ReactNode
}

export default function OnboardingChecklist({ steps, lineCta, extensionCta }: Props) {
  const t = useT()
  const doneCount = Object.values(steps).filter((s) => s === 'done').length
  const total = 4
  const percent = Math.round((doneCount / total) * 100)

  if (doneCount === total) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center text-lg">
          ✓
        </div>
        <div className="flex-1">
          <p className="font-semibold text-green-900">{t('dashboard', 'allSetup')}</p>
          <p className="text-sm text-green-700">LiveWatch พร้อมใช้งานแล้ว</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">{t('dashboard', 'onboardingTitle')}</h2>
        <p className="text-sm text-gray-500 mt-1">
          {doneCount}/{total} ขั้นตอน ({percent}%)
        </p>
        <div className="mt-3 h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <StepCard number={1} title={t('dashboard', 'stepAccountTitle')} status={steps.account} />
      <StepCard
        number={2}
        title={t('dashboard', 'stepLineTitle')}
        description={t('dashboard', 'stepLineDesc')}
        status={steps.line}
        cta={lineCta}
      />
      <StepCard
        number={3}
        title={t('dashboard', 'stepExtensionTitle')}
        description={t('dashboard', 'stepExtensionDesc')}
        status={steps.extension}
        cta={extensionCta}
      />
      <StepCard
        number={4}
        title={t('dashboard', 'stepLiveTitle')}
        description={t('dashboard', 'stepLiveDesc')}
        status={steps.live}
      />
    </div>
  )
}
