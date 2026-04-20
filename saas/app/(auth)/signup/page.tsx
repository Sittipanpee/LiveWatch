'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button, Card, Input, Alert } from '@/components/ui'
import { useT } from '@/components/LocaleProvider'

export default function SignupPage() {
  const router = useRouter()
  const t = useT()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const extId = params.get('extId')
    if (extId) sessionStorage.setItem('lw_extId', extId)

    // Redirect to dashboard if already logged in
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) router.replace('/dashboard')
    })
  }, [router])

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (!agreed) {
      setError('กรุณายอมรับข้อตกลงและนโยบายความเป็นส่วนตัว')
      return
    }
    setError(null)
    setLoading(true)
    const supabase = createClient()
    const { error: authError } = await supabase.auth.signUp({ email, password })
    setLoading(false)
    if (authError) {
      setError(authError.message)
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-6 py-12 bg-gray-50">
      <Card className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-block w-12 h-12 rounded-2xl bg-brand mb-4" />
          <h1 className="text-2xl font-bold">{t('auth', 'signUpHeading')}</h1>
          <p className="text-sm text-gray-500 mt-1">Create an account</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <Input
            id="email"
            type="email"
            required
            label={t('auth', 'email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            label={t('auth', 'password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              required
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              ฉันยอมรับ{' '}
              <Link href="/terms" className="text-brand hover:underline">
                ข้อตกลง
              </Link>{' '}
              และ{' '}
              <Link href="/privacy" className="text-brand hover:underline">
                นโยบายความเป็นส่วนตัว
              </Link>
            </span>
          </label>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={loading}
            className="w-full"
          >
            {loading ? t('common', 'loading') : t('auth', 'signUpHeading')}
          </Button>
        </form>
        <p className="text-center text-sm text-gray-600 mt-6">
          {t('auth', 'hasAccount')}{' '}
          <Link href="/login" className="text-brand font-semibold hover:underline">
            {t('auth', 'signInHeading')} →
          </Link>
        </p>
      </Card>
    </div>
  )
}
