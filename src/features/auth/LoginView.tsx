// FISCALO — Pantalla de acceso (login).
// Conecta con POST /api/auth/login del backend api-gratex. El acceso es
// multi-tenant: el tenant_id (código de empresa) viene del .env (VITE_TENANT_ID),
// no lo teclea el usuario. El alta de usuarios la hace un administrador.
import { useState, type FormEvent } from 'react'
import { Icon, Btn, Spinner } from '@/components/ui'
import { login } from '@/api/auth'
import { TENANT_ID } from '@/api/config'
import { setSession } from '@/auth/session'

export function LoginView() {
  const [emailOrUsername, setEmailOrUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await login(emailOrUsername.trim(), password, TENANT_ID)
      setSession(res.token, res.user)
      // En éxito, setSession re-renderiza App y desmonta esta vista (no tocar estado).
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocurrió un error inesperado.')
      setLoading(false)
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="auth-logo">F</span>
          <span className="auth-title">Fiscalo</span>
        </div>
        <h1 className="auth-heading">Iniciar sesión</h1>
        <p className="auth-sub">Accede a tu panel de facturación electrónica (e-CF / DGII).</p>

        {error && (
          <div className="auth-error" role="alert">
            <Icon name="alert-circle" size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="emailOrUsername">Correo o usuario</label>
          <input id="emailOrUsername" className="input" autoComplete="username" placeholder="ana@empresa.do"
            value={emailOrUsername} onChange={(e) => setEmailOrUsername(e.target.value)} required autoFocus />
        </div>

        <div className="field">
          <label className="label" htmlFor="password">Contraseña</label>
          <div className="auth-pw">
            <input id="password" className="input" type={showPw ? 'text' : 'password'}
              autoComplete="current-password" placeholder="••••••••"
              value={password} onChange={(e) => setPassword(e.target.value)} required minLength={4} />
            <button type="button" onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? 'Ocultar contraseña' : 'Mostrar contraseña'} tabIndex={-1}>
              <Icon name="eye" size={16} />
            </button>
          </div>
        </div>

        <Btn type="submit" variant="primary" size="lg" className="auth-submit" disabled={loading}>
          {loading ? <><Spinner /> Entrando…</> : 'Entrar'}
        </Btn>

        <div className="auth-foot">Facturación electrónica RD · e-CF / DGII</div>
      </form>
    </div>
  )
}
