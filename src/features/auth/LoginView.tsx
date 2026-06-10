// FISCALO — Pantalla de acceso (login).
// Conecta con POST /api/auth/login del backend api-gratex. El acceso es
// multi-tenant: el tenant_id (código de empresa) viene del .env (VITE_TENANT_ID),
// no lo teclea el usuario. El alta de usuarios la hace un administrador.
import { useState, type FormEvent } from 'react'
import { Icon, Btn, Spinner } from '@/components/ui'
import { login } from '@/api/auth'
import { TENANT_ID } from '@/api/config'
import { setSession } from '@/auth/session'

/** Bullets del panel de marca (izquierda). */
const FEATURES = [
  { icon: 'badge-check', t: 'e-CF en segundos', s: 'Crédito fiscal, consumo, notas y más' },
  { icon: 'shield-check', t: 'Firma y envío automáticos', s: 'Directo a la DGII, sin pasos manuales' },
  { icon: 'refresh-cw', t: 'Estado en tiempo real', s: 'Secuencias NCF y respuestas al instante' },
]

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
      {/* Panel de marca (oculto en móvil) */}
      <aside className="auth-aside">
        <div className="auth-aside-brand">
          <span className="auth-aside-logo">F</span>
          <span className="auth-aside-name">Fiscalo</span>
        </div>

        <div>
          <h2 className="auth-aside-headline">Tu facturación electrónica, siempre al día con la DGII.</h2>
          <p className="auth-aside-tagline">
            Emite, firma y envía tus comprobantes fiscales electrónicos (e-CF) sin fricción, desde un solo lugar.
          </p>
          <ul className="auth-features">
            {FEATURES.map((f) => (
              <li key={f.t} className="auth-feature">
                <span className="auth-feature-ic"><Icon name={f.icon} size={19} /></span>
                <div>
                  <div className="auth-feature-t">{f.t}</div>
                  <div className="auth-feature-s">{f.s}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="auth-aside-foot">República Dominicana · e-CF / DGII</div>
      </aside>

      {/* Formulario */}
      <main className="auth-main">
        <form className="auth-form" onSubmit={submit}>
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
      </main>
    </div>
  )
}
