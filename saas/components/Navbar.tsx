'use client'
import Link from 'next/link'
import LanguageSwitcher from './LanguageSwitcher'
import { useT } from './LocaleProvider'

export default function Navbar() {
  const t = useT()
  return (
    <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-brand">
          <span className="inline-block w-8 h-8 rounded-full bg-brand" />
          LiveWatch
        </Link>
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          <Link href="/login" className="text-sm text-gray-600 hover:text-brand">{t('nav', 'signIn')}</Link>
          <Link href="/signup" className="text-sm px-4 py-2 rounded-xl bg-accent text-white hover:bg-accent-dark transition font-semibold">{t('nav', 'signUp')}</Link>
        </div>
      </div>
    </header>
  )
}
