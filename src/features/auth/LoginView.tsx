// FISCALO — Pantalla de acceso (login), diseño "Bold": split con panel de marca.
// Conecta con POST /api/auth/login del backend api-gratex. El acceso es
// multi-tenant: el tenant_id (código de empresa) viene del .env (VITE_TENANT_ID),
// no lo teclea el usuario. El alta de usuarios la hace un administrador.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Icon, Btn, Image } from '@/components/ui'
import { login } from '@/api/auth'
import { TENANT_ID } from '@/api/config'
import { setSession } from '@/stores/auth'

interface FieldErrors {
  user?: string | null
  pass?: string | null
}

export function LoginView() {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const userRef = useRef<HTMLInputElement>(null)

  useEffect(() => { userRef.current?.focus() }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: FieldErrors = {}
    if (!user.trim()) errs.user = 'Ingresa tu correo o usuario.'
    if (!pass) errs.pass = 'Ingresa tu contraseña.'
    setErrors(errs)
    setServerError(null)
    if (Object.keys(errs).length > 0) return
    setLoading(true)
    try {
      const res = await login(user.trim(), pass, TENANT_ID)
      setSession(res.token, res.user)
      // En éxito, setSession re-renderiza App y desmonta esta vista (no tocar estado).
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Ocurrió un error inesperado.')
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">

      {/* ---- Panel de marca (izquierda) ---- */}
      <aside className="login-aside">
        <div className="login-aside-grid" aria-hidden="true"></div>
        <div className="login-aside-glow" aria-hidden="true"></div>

        <div className="login-aside-top">
          <div className="login-brand">
            <Image className="brand-icon" src="/assets/logos/fiscalpoit-notext.png" alt="" />
            <span className="brand-name">FiscalPoint<b>.</b></span>
          </div>
        </div>

        <div className="login-aside-mid">
          <div className="login-ecf-badge">
            <span className="login-ecf-dot"></span>
            Comprobante e-CF · 31
          </div>
          <h1 className="login-headline">Tu facturación fiscal,<br />en orden y al día.</h1>
          <p className="login-tagline">Emite, firma y transmite tus comprobantes electrónicos a la DGII desde un solo lugar.</p>

          <ul className="login-feats">
            <li><span className="login-feat-ic"><Icon name="zap" size={15} /></span>Emisión de e-CF en segundos</li>
            <li><span className="login-feat-ic"><Icon name="shield-check" size={15} /></span>Validación automática con la DGII</li>
            <li><span className="login-feat-ic"><Icon name="line-chart" size={15} /></span>Reportes de ITBIS siempre al día</li>
          </ul>
        </div>

        <div className="login-aside-foot">
          <span className="login-status-dot"></span>
          Conectado a la DGII · Ambiente de Certificación
        </div>
      </aside>

      {/* ---- Formulario (derecha) ---- */}
      <main className="login-main">
        <div className="login-card">
          <div className="login-brand login-brand-mobile">
            <Image className="brand-icon" src="/assets/logos/fiscalpoit-notext.png" alt="" />
            <span className="brand-name">FiscalPoint<b>.</b></span>
          </div>

          <h2 className="login-title">Bienvenido de nuevo</h2>
          <p className="login-sub">Inicia sesión para continuar con tu facturación.</p>

          {serverError && (
            <div className="login-error" role="alert">
              <Icon name="alert-circle" size={16} />
              <span>{serverError}</span>
            </div>
          )}

          <form onSubmit={submit} noValidate>
            <div className={'field' + (errors.user ? ' field-error' : '')}>
              <label htmlFor="login-user">Correo o usuario</label>
              <input
                id="login-user"
                ref={userRef}
                className="input"
                type="text"
                autoComplete="username"
                placeholder="ana@empresa.do"
                value={user}
                onChange={(e) => { setUser(e.target.value); if (errors.user) setErrors({ ...errors, user: null }) }}
              />
              {errors.user && <div className="err-msg"><Icon name="alert-circle" size={13} />{errors.user}</div>}
            </div>

            <div className={'field' + (errors.pass ? ' field-error' : '')}>
              <div className="login-pass-row">
                <label htmlFor="login-pass">Contraseña</label>
              </div>
              <div className="login-pass-wrap">
                <input
                  id="login-pass"
                  className="input"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={pass}
                  onChange={(e) => { setPass(e.target.value); if (errors.pass) setErrors({ ...errors, pass: null }) }}
                />
                <button
                  type="button"
                  className="login-pass-toggle"
                  title={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  onClick={() => setShowPass(!showPass)}
                  tabIndex={-1}
                >
                  <Icon name={showPass ? 'eye-off' : 'eye'} size={16} />
                </button>
              </div>
              {errors.pass && <div className="err-msg"><Icon name="alert-circle" size={13} />{errors.pass}</div>}
            </div>

            <Btn variant="primary" type="submit" className="login-submit" disabled={loading} icon={loading ? 'loader' : undefined}>
              {loading ? 'Iniciando…' : 'Iniciar sesión'}
            </Btn>
          </form>

          <p className="login-foot">Facturación Electrónica · DGII · República Dominicana</p>
        </div>
      </main>
    </div>
  )
}
