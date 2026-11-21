// Habilitar este equipo como caja (docs/specs/pos.md A3, A4).
//
// Dos pasos: (1) un admin entra — con usuario y clave, o ya entrado por el
// codigo del boton POS de app.* — y (2) elige la caja. El servidor entrega el
// token del equipo, que se guarda en este navegador. La sesion de FiscalPoint de
// quien lo habilito NO se cierra aqui: se entrega a quien monta esto (PosApp), que
// ve si le toca crear su PIN (A5b) y la cierra al terminar (POST /api/auth/signout).
// Un usuario que no administra el POS puede llegar hasta aqui con el boton POS en un
// equipo que todavia no es una caja: ve que hace falta un administrador y nada mas.
//
// PasoLogin tambien es la pantalla "Crea tu PIN con tu usuario" del teclado del PIN.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Btn, Icon } from '@/components/ui'
import { posApi, PosApiError, type Caja, type LoginAdmin } from './api'
import type { EquipoGuardado } from './store'

interface Props {
  /** Admin ya entrado por el codigo del boton POS (se salta el login). */
  adminInicial?: LoginAdmin | null
  /** Por que se llego aqui (equipo revocado, codigo vencido...). */
  aviso?: string | null
  /** El equipo quedó habilitado. `usuario` es la sesión de FiscalPoint de quien lo habilitó: quien recibe esto la cierra. */
  onListo: (equipo: EquipoGuardado, usuario: LoginAdmin) => void
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
    : <PasoCaja admin={admin} onListo={onListo} onCancelar={onCancelar} onOtroUsuario={() => setAdmin(null)} />
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

/**
 * Usuario y clave de FiscalPoint. `habilitar` (lo normal): un administrador, para habilitar el equipo.
 * `usuario`: cualquier usuario de la empresa, desde el teclado del PIN, para crear su PIN (primera vez o restablecido).
 * `onEntro` puede ser asíncrono: mientras responde, el botón queda en "Entrando…"; si lanza, el error se
 * muestra aquí mismo.
 */
export function PasoLogin({ modo = 'habilitar', aviso, onEntro, onCancelar }: {
  modo?: 'habilitar' | 'usuario'
  aviso: string | null
  onEntro: (a: LoginAdmin) => void | Promise<void>
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
      await onEntro(await posApi.login(usuario.trim(), clave))
    } catch (err) {
      setError(textoError(err))
      setCargando(false)
    }
  }

  return (
    <div className="pos-centro">
      <form className="pos-panel" onSubmit={enviar} noValidate>
        <Marca />
        <h1 className="pos-titulo">{modo === 'usuario' ? 'Crea tu PIN con tu usuario' : 'Habilitar este equipo'}</h1>
        <p className="pos-sub">
          {modo === 'usuario'
            ? 'Entra con tu usuario y contraseña de FiscalPoint para crear tu PIN: es tu primera vez en el POS o un administrador te lo restableció. Después entras solo con el PIN.'
            : 'Un administrador de la empresa entra una sola vez para convertir esta computadora en una caja. Después, cada persona entra con su PIN.'}
        </p>
        {aviso && <div className="pos-aviso"><Icon name="alert-triangle" size={16} /><span>{aviso}</span></div>}
        {error && <div className="pos-error"><Icon name="alert-circle" size={16} /><span>{error}</span></div>}
        <div className="pos-campo">
          <label htmlFor="pos-usuario">{modo === 'usuario' ? 'Usuario o correo' : 'Usuario o correo del administrador'}</label>
          <input id="pos-usuario" ref={ref} autoComplete="username" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
        </div>
        <div className="pos-campo">
          <label htmlFor="pos-clave">Contraseña</label>
          <input id="pos-clave" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} />
        </div>
        <Btn type="submit" variant="primary" className="pos-boton-grande" disabled={cargando}>
          {cargando ? 'Entrando…' : 'Continuar'}
        </Btn>
        {onCancelar && <div style={{ textAlign: 'center' }}><button type="button" className="pos-enlace" onClick={onCancelar}>{modo === 'usuario' ? 'Volver al PIN' : 'Cancelar'}</button></div>}
      </form>
    </div>
  )
}

function PasoCaja({ admin, onListo, onCancelar, onOtroUsuario }: {
  admin: LoginAdmin
  onListo: (e: EquipoGuardado, usuario: LoginAdmin) => void
  onCancelar?: () => void
  onOtroUsuario: () => void
}) {
  const [cajas, setCajas] = useState<Caja[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Este usuario no administra el POS: no puede habilitar cajas (llegó con el botón POS a un equipo que aún no es caja).
  const [sinPermiso, setSinPermiso] = useState(false)
  const [ocupada, setOcupada] = useState<{ caja: Caja; equipo: string | null } | null>(null)
  const [nueva, setNueva] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vivo = true
    posApi.cajas(admin.token)
      .then((r) => { if (vivo) setCajas(r.cajas.filter((c) => c.activa)) })
      .catch((e) => {
        if (!vivo) return
        if (e instanceof PosApiError && e.codigo === 'SIN_PERMISO') {
          // No puede seguir aquí: su sesión ya no hace falta.
          posApi.cerrarAdmin(admin.token).catch(() => undefined)
          setSinPermiso(true)
          return
        }
        setError(textoError(e))
        setCajas([])
      })
    return () => { vivo = false }
  }, [admin.token])

  const habilitar = async (caja: Caja, reemplazar: boolean) => {
    setOcupado(true)
    setError(null)
    try {
      const r = await posApi.habilitar(admin.token, caja.id, reemplazar)
      // La sesion de FiscalPoint no se cierra aqui: quien recibe el equipo ve si a este usuario le toca crear su PIN, y la cierra.
      onListo({ token: r.token, caja: r.equipo.caja, empresa: null }, admin)
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

  if (sinPermiso) {
    return (
      <div className="pos-centro">
        <div className="pos-panel">
          <Marca />
          <h1 className="pos-titulo">Este equipo todavía no es una caja</h1>
          <p className="pos-sub">
            Hola, {admin.user.name}. Para usar el POS aquí, un administrador de tu empresa tiene que habilitar esta
            computadora como caja: entra una sola vez con su usuario. Después podrás entrar con tu PIN.
          </p>
          <div style={{ display: 'grid', gap: 10 }}>
            <Btn variant="primary" className="pos-boton-grande" onClick={onOtroUsuario}>Entrar con otro usuario</Btn>
            {onCancelar && <Btn className="pos-boton-grande" onClick={onCancelar}>Cancelar</Btn>}
          </div>
        </div>
      </div>
    )
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
