'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const extId = params.get('extId')
    if (extId) sessionStorage.setItem('lw_extId', extId)
  }, [])

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()
    const { error: authError } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })
    setLoading(false)
    if (authError) {
      setError(authError.message)
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  const title = mode === 'signin' ? 'เข้าสู่ระบบ' : 'สมัครใช้งาน'
  const titleEn = mode === 'signin' ? 'Sign in' : 'Create an account'

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0, color: 'var(--brand)' }}>LiveWatch</h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          AI monitor สำหรับไลฟ์คอมเมิร์ซ
        </p>
      </div>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>
          {title} <span className="label-en">/ {titleEn}</span>
        </h2>
        <form onSubmit={onSubmit}>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 600 }}>
              อีเมล <span className="label-en">/ Email</span>
            </div>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label style={{ display: 'block', marginBottom: 16 }}>
            <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 600 }}>
              รหัสผ่าน <span className="label-en">/ Password</span>
            </div>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? (
            <p style={{ color: 'crimson', fontSize: 13 }}>❌ {error}</p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="btn-primary"
            style={{ width: '100%' }}
          >
            {loading ? '...' : `${title} / ${titleEn}`}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          style={{
            marginTop: 12,
            background: 'none',
            border: 'none',
            color: 'var(--brand)',
            cursor: 'pointer',
            width: '100%',
            fontSize: 13,
          }}
        >
          {mode === 'signin'
            ? 'ยังไม่มีบัญชี? สมัครใช้งาน / Create an account'
            : 'มีบัญชีแล้ว? เข้าสู่ระบบ / Have an account? Sign in'}
        </button>
      </section>
    </main>
  )
}
