'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { getBrowserSupabase } from '../../features/auth/supabase-client'

export default function ResetPasswordPage() {
  const client = getBrowserSupabase()
  const [sessionReady, setSessionReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!client) { setLoading(false); return }
    let mounted = true
    client.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSessionReady(Boolean(data.session))
      setLoading(false)
    }, () => { if (mounted) setLoading(false) })
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (mounted) { setSessionReady(Boolean(session)); setLoading(false) }
    })
    return () => { mounted = false; data.subscription.unsubscribe() }
  }, [client])

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault()
    if (!client || !sessionReady || busy) return
    if (password !== repeat) { setMessage('הסיסמאות אינן תואמות.'); return }
    setBusy(true)
    setMessage(null)
    const { error } = await client.auth.updateUser({ password })
    setBusy(false)
    if (error) setMessage('עדכון הסיסמה נכשל. נסו לבקש קישור חדש.')
    else { setDone(true); setPassword(''); setRepeat('') }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-5 py-10 text-[var(--text)]">
      <h1 className="text-2xl font-bold">איפוס סיסמה</h1>
      {loading ? <p>בודקים את הקישור...</p> : done ? (
        <div className="space-y-4"><p role="status">הסיסמה עודכנה. אפשר לחזור לאתר.</p><Link href="/" className="underline">חזרה ל־Syllo</Link></div>
      ) : !sessionReady ? (
        <div className="space-y-4"><p role="alert">הקישור אינו תקף או שפג תוקפו. בקשו קישור חדש מחלון ההתחברות.</p><Link href="/" className="underline">חזרה לאתר</Link></div>
      ) : (
        <form className="space-y-4" onSubmit={(event) => void updatePassword(event)}>
          <label className="block space-y-1"><span>סיסמה חדשה</span><input type="password" autoComplete="new-password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2" /></label>
          <label className="block space-y-1"><span>אימות סיסמה חדשה</span><input type="password" autoComplete="new-password" minLength={6} required value={repeat} onChange={(event) => setRepeat(event.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2" /></label>
          <button type="submit" disabled={busy || password.length < 6 || repeat.length < 6} className="w-full rounded-lg bg-[var(--purple-strong)] px-3 py-2 font-semibold text-white disabled:opacity-60">שמירת סיסמה חדשה</button>
          {message && <p role="alert">{message}</p>}
        </form>
      )}
    </main>
  )
}
