'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { Sparkles, Bell, LineChart } from 'lucide-react'
import { Button } from '@/components/ui'
import { useT } from '@/components/LocaleProvider'

export default function HomePage() {
  const t = useT()
  return (
    <>
      <section className="max-w-5xl mx-auto px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-50 text-brand text-sm font-medium mb-6">
          <Sparkles className="w-4 h-4" />
          AI for Thai live-commerce
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
          {t('landing', 'heroTitle')}
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto mb-10">
          {t('landing', 'heroSubtitle')}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/signup">
            <Button variant="primary" size="lg">
              {t('landing', 'ctaPrimary')}
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="secondary" size="lg">
              {t('landing', 'ctaSecondary')}
            </Button>
          </Link>
        </div>
        <p className="text-xs text-gray-500 mt-6">{t('landing', 'trustLine')}</p>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-24 grid md:grid-cols-3 gap-6">
        <FeatureCard
          icon={<LineChart className="w-6 h-6" />}
          titleKey="feature1Title"
          descKey="feature1Desc"
        />
        <FeatureCard
          icon={<Bell className="w-6 h-6" />}
          titleKey="feature2Title"
          descKey="feature2Desc"
        />
        <FeatureCard
          icon={<Sparkles className="w-6 h-6" />}
          titleKey="feature3Title"
          descKey="feature3Desc"
        />
      </section>
    </>
  )
}

interface FeatureCardProps {
  icon: ReactNode
  titleKey: string
  descKey: string
}

function FeatureCard({ icon, titleKey, descKey }: FeatureCardProps) {
  const t = useT()
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 hover:shadow-md transition-shadow">
      <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold mb-2">{t('landing', titleKey)}</h3>
      <p className="text-sm text-gray-600 leading-relaxed">{t('landing', descKey)}</p>
    </div>
  )
}
