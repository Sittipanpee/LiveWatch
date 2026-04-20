'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import LanguageSwitcher from './LanguageSwitcher'
import { useT } from './LocaleProvider'

export default function Navbar() {
  const t = useT()
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    setEmail(null)
    router.push('/login')
  }

  return (
    <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-brand">
          <span className="inline-block w-8 h-8 rounded-full bg-brand" />
          LiveWatch
        </Link>
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          {loading ? null : email ? (
            <>
              <Link href="/dashboard" className="text-sm text-gray-600 hover:text-brand">
                {t('nav', 'dashboard')}
              </Link>
              <Link href="/sessions" className="text-sm text-gray-600 hover:text-brand">
                {t('nav', 'sessions')}
              </Link>
              <button
                onClick={handleSignOut}
                className="text-sm text-gray-600 hover:text-red-600 transition cursor-pointer"
              >
                {t('nav', 'signOut')}
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="text-sm text-gray-600 hover:text-brand">
                {t('nav', 'signIn')}
              </Link>
              <Link
                href="/signup"
                className="text-sm px-4 py-2 rounded-xl bg-accent text-white hover:bg-accent-dark transition font-semibold"
              >
                {t('nav', 'signUp')}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
