'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { dict, type Locale, type LocalizedString } from '@/lib/i18n'

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (group: keyof typeof dict, key: string) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('th')

  useEffect(() => {
    const stored = localStorage.getItem('lw_locale')
    if (stored === 'th' || stored === 'en') setLocaleState(stored)
  }, [])

  const setLocale = (next: Locale): void => {
    setLocaleState(next)
    localStorage.setItem('lw_locale', next)
    document.cookie = `lw_locale=${next}; path=/; max-age=31536000; samesite=lax`
  }

  const t = (group: keyof typeof dict, key: string): string => {
    const g = dict[group] as Record<string, LocalizedString | undefined>
    const entry = g[key]
    if (!entry) return key
    return entry[locale] ?? entry.th
  }

  return <LocaleContext.Provider value={{ locale, setLocale, t }}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used inside LocaleProvider')
  return ctx
}

export function useT(): LocaleContextValue['t'] {
  return useLocale().t
}
