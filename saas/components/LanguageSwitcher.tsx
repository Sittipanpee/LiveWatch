'use client'
import { useLocale } from './LocaleProvider'
import { cn } from '@/lib/utils'

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLocale()
  return (
    <div className="inline-flex rounded-full bg-gray-100 p-1 text-xs">
      <button
        type="button"
        onClick={() => setLocale('th')}
        className={cn('px-3 py-1 rounded-full transition', locale === 'th' ? 'bg-white shadow text-brand font-semibold' : 'text-gray-500')}
      >ไทย</button>
      <button
        type="button"
        onClick={() => setLocale('en')}
        className={cn('px-3 py-1 rounded-full transition', locale === 'en' ? 'bg-white shadow text-brand font-semibold' : 'text-gray-500')}
      >EN</button>
    </div>
  )
}
