// Habilitar este equipo como caja (docs/specs/pos.md A3, A4).
//
// Dos pasos: (1) un admin entra — con usuario y clave, o ya entrado por el
// codigo del boton POS de app.* — y (2) elige la caja. El servidor entrega el
// token del equipo, que se guarda en este navegador; la sesion del admin se
// cierra en el acto (POST /api/auth/signout). Los cajeros nunca ven esto.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Btn, Icon } from '@/components/ui'
import { posApi, PosApiError, type Caja, type LoginAdmin } from './api'
import type { EquipoGuardado } from './store'

interface Props {
  /** Admin ya entrado por el codigo del boton POS (se salta el login). */
  adminInicial?: LoginAdmin | null
  /** Por que se llego aqui (equipo revocado, codigo vencido...). */
  aviso?: string | null
  onListo: (equipo: EquipoGuardado) => void
  /** Volver sin cambiar nada (solo si este equipo ya estaba habilitado). */
  onCancelar?: () => void
}

/** Texto para la persona segun el codigo del backend. */
function textoError(e: unknown): string {
  if (!(e instanceof PosApiError)) return 'Ocurrió un error inesperado. Inténtalo de nuevo.'
  if (e.codigo === 'SIN_PERMISO') return 'Tu usuario no puede administrar el POS. Entra con un administrador.'
  if (e.codigo === 'POS_INACTIVO') return 'El POS no está activo para esta empresa. Pídelo a soporte de FiscalPoint.'
  return e.message
}

export function HabilitarEquipo({ adminInicial = null, aviso = null, onListo, onCancelar }: Props) {
  const [admin, setAdmin] = useState<LoginAdmin | null>(adminInicial)

  return admin === null
    ? <PasoLogin aviso={aviso} onEntro={setAdmin} onCancelar={onCancelar} />
    : <PasoCaja admin={admin} onListo={onListo} onCancelar={onCancelar} />
}

// ---------------------------------------------------------------------------

function Marca() {
  return (
    <div className="pos-marca">
      <Icon name="store" size={20} style={{ color: 'var(--accent)' }} />
      <span className="brand-name">FiscalPoint POS</span>
    </div>
  )
}

function PasoLogin({ aviso, onEntro, onCancelar }: {
  aviso: string | null
  onEntro: (a: LoginAdmin) => void
  onCancelar?: () => void
}) {
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (!usuario.trim() || !clave) {
      setError('Escribe tu usuario o correo y tu contraseña.')
      return
    }
    setCargando(true)
    setError(null)
    try {
      onEntro(await posApi.login(usuario.trim(), clave))
    } catch (err) {
      setError(textoError(err))
      setCargando(false)
    }
  }

  return (
    <div className="pos-centro">
      <form className="pos-panel" onSubmit={enviar} noValidate>
        <Marca />
        <h1 className="pos-titulo">Habilitar este equipo</h1>
        <p className="pos-sub">
          Un administrador de la empresa entra una sola vez para convertir esta computadora en una caja.
          Después, los cajeros entran con su PIN.
        </p>
        {aviso && <div className="pos-aviso"><Icon name="alert-triangle" size={16} /><span>{aviso}</span></div>}
        {error && <div className="pos-error"><Icon name="alert-circle" size={16} /><span>{error}</span></div>}
        <div className="pos-campo">
          <label htmlFor="pos-usuario">Usuario o correo del administrador</label>
          <input id="pos-usuario" ref={ref} autoComplete="username" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
        </div>
        <div className="pos-campo">
          <label htmlFor="pos-clave">Contraseña</label>
          <input id="pos-clave" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} />
        </div>
        <Btn type="submit" variant="primary" className="pos-boton-grande" disabled={cargando}>
          {cargando ? 'Entrando…' : 'Continuar'}
        </Btn>
        {onCancelar && <div style={{ textAlign: 'center' }}><button type="button" className="pos-enlace" onClick={onCancelar}>Cancelar</button></div>}
      </form>
    </div>
  )
}

function PasoCaja({ admin, onListo, onCancelar }: {
  admin: LoginAdmin
  onListo: (e: EquipoGuardado) => void
  onCancelar?: () => void
}) {
  const [cajas, setCajas] = useState<Caja[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupada, setOcupada] = useState<{ caja: Caja; equipo: string | null } | null>(null)
  const [nueva, setNueva] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vivo = true
    posApi.cajas(admin.token)
      .then((r) => { if (vivo) setCajas(r.cajas.filter((c) => c.activa)) })
      .catch((e) => { if (vivo) { setError(textoError(e)); setCajas([]) } })
    return () => { vivo = false }
  }, [admin.token])

  const habilitar = async (caja: Caja, reemplazar: boolean) => {
    setOcupado(true)
    setError(null)
    try {
      const r = await posApi.habilitar(admin.token, caja.id, reemplazar)
      // La sesion del admin ya no hace falta: se cierra sin esperar.
      posApi.cerrarAdmin(admin.token).catch(() => undefined)
      onListo({ token: r.token, caja: r.equipo.caja, empresa: null })
    } catch (e) {
      if (e instanceof PosApiError && e.codigo === 'CAJA_OCUPADA') {
        const actual = e.extra.equipo_actual as { nombre?: string | null } | undefined
        setOcupada({ caja, equipo: actual?.nombre ?? null })
      } else {
        setError(textoError(e))
      }
      setOcupado(false)
    }
  }

  const crear = async (e: FormEvent) => {
    e.preventDefault()
    if (!nueva.trim()) return
    setOcupado(true)
    setError(null)
    try {
      const r = await posApi.crearCaja(admin.token, nueva.trim())
      setCajas((cs) => [...(cs ?? []), r.caja])
      setNueva('')
    } catch (err) {
      setError(textoError(err))
    }
    setOcupado(false)
  }

  if (ocupada) {
    return (
      <div className="pos-centro">
        <div className="pos-panel">
          <Marca />
          <h1 className="pos-titulo">¿Reemplazar el equipo de {ocupada.caja.nombre}?</h1>
          <p className="pos-sub">
            {ocupada.equipo ? `«${ocupada.equipo}»` : 'Otro equipo'} ya está habilitado como {ocupada.caja.nombre}.
            Si este lo reemplaza, el otro deja de funcionar como caja y su sesión se cierra.
          </p>
          <div style={{ display: 'grid', gap: 10 }}>
            <Btn variant="danger" className="pos-boton-grande" disabled={ocupado} onClick={() => habilitar(ocupada.caja, true)}>
              {ocupado ? 'Habilitando…' : `Sí, reemplazarlo`}
            </Btn>
            <Btn className="pos-boton-grande" disabled={ocupado} onClick={() => setOcupada(null)}>Elegir otra caja</Btn>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pos-centro">
      <div className="pos-panel">
        <Marca />
        <h1 className="pos-titulo">¿Qué caja es este equipo?</h1>
        <p className="pos-sub">Hola, {admin.user.name}. Elige la caja; queda guardada en este navegador.</p>
        {error && <div className="pos-error"><Icon name="alert-circle" size={16} /><span>{error}</span></div>}

        {cajas === null ? (
          <div style={{ display: 'grid', placeItems: 'center', padding: 24 }}><div className="spinner" /></div>
        ) : (
          <>
            {cajas.length > 0 ? (
              <div className="pos-cajas">
                {cajas.map((c) => (
                  <button key={c.id} type="button" className="pos-caja" disabled={ocupado} onClick={() => habilitar(c, false)}>
                    <Icon name="monitor" size={20} />{c.nombre}
                  </button>
                ))}
              </div>
            ) : (
              <div className="pos-info"><Icon name="info" size={16} /><span>Todavía no hay cajas. Crea la primera.</span></div>
            )}
            <form className="pos-fila" onSubmit={crear}>
              <div className="pos-campo">
                <label htmlFor="pos-nueva-caja">Nueva caja</label>
                <input id="pos-nueva-caja" placeholder="Caja 1" value={nueva} maxLength={60} onChange={(e) => setNueva(e.target.value)} />
              </div>
              <Btn type="submit" icon="plus" disabled={ocupado || !nueva.trim()} style={{ alignSelf: 'flex-end', height: 48 }}>Crear</Btn>
            </form>
          </>
        )}
        {onCancelar && (
          <div style={{ textAlign: 'center' }}>
            <button
              type="button" className="pos-enlace"
              onClick={() => { posApi.cerrarAdmin(admin.token).catch(() => undefined); onCancelar() }}
            >Cancelar</button>
          </div>
        )}
      </div>
    </div>
  )
}
