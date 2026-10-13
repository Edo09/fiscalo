// FISCALO — POS (pos.fiscalpoint.com.do): que pantalla toca.
//
//   sin equipo guardado ............ Habilitar (login de admin o codigo del boton POS)
//   equipo guardado ................ PIN  (el codigo del boton, si viene, se ignora:
//                                          el equipo ya esta habilitado — A2)
//   PIN correcto ................... Venta (con bloqueo de pantalla)
//   equipo revocado ................ Habilitar, con aviso
//   empresa sin POS ................ aviso, sin nada que hacer en este equipo
import { useCallback, useEffect, useRef, useState } from 'react'
import { Btn, Icon } from '@/components/ui'
import { posApi, PosApiError, type LoginAdmin, type SesionPos } from './api'
import { usePosStore, type EquipoGuardado } from './store'
import { useCarritoStore } from './carrito'
import { HabilitarEquipo } from './HabilitarEquipo'
import { PinView } from './PinView'
import { VentaView } from './VentaView'

type Pantalla =
  | { tipo: 'cargando' }
  | { tipo: 'habilitar'; admin: LoginAdmin | null; aviso: string | null; cancelable: boolean }
  | { tipo: 'pin' }
  | { tipo: 'venta' }
  | { tipo: 'sin-pos'; motivo: string }
  | { tipo: 'sin-red' }

/** Codigo del boton POS de app.* (#code=<48 hex>). Lo quita de la URL al leerlo. */
function tomarCodigoDelHash(): string | null {
  const m = /(?:^#|&)code=([0-9a-f]{48})(?:&|$)/.exec(window.location.hash)
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  return m ? m[1] : null
}

function useEnLinea(): boolean {
  const [enLinea, setEnLinea] = useState(() => navigator.onLine)
  useEffect(() => {
    const si = () => setEnLinea(true)
    const no = () => setEnLinea(false)
    window.addEventListener('online', si)
    window.addEventListener('offline', no)
    return () => { window.removeEventListener('online', si); window.removeEventListener('offline', no) }
  }, [])
  return enLinea
}

const AVISO_REVOCADO = 'Este equipo ya no está habilitado como caja. Un administrador tiene que habilitarlo de nuevo.'

export function PosApp() {
  const equipo = usePosStore((s) => s.equipo)
  const sesion = usePosStore((s) => s.sesion)
  const { guardarEquipo, olvidarEquipo, abrirSesion, cerrarSesion } = usePosStore.getState()
  const [pantalla, setPantalla] = useState<Pantalla>({ tipo: 'cargando' })
  const enLinea = useEnLinea()
  const arrancado = useRef(false)

  const arrancar = useCallback(async () => {
    setPantalla({ tipo: 'cargando' })
    const codigo = tomarCodigoDelHash()
    const guardado = usePosStore.getState().equipo
    let aviso: string | null = null

    if (guardado) {
      try {
        const r = await posApi.estado(guardado.token)
        guardarEquipo({ ...guardado, caja: r.caja ?? guardado.caja, empresa: r.empresa.nombre })
        setPantalla({ tipo: 'pin' })
        return
      } catch (e) {
        if (e instanceof PosApiError && e.codigo === 'EQUIPO_NO_HABILITADO') {
          olvidarEquipo()
          aviso = AVISO_REVOCADO
        } else if (e instanceof PosApiError && (e.codigo === 'POS_INACTIVO' || e.codigo === 'EMPRESA_INACTIVA')) {
          setPantalla({ tipo: 'sin-pos', motivo: e.message })
          return
        } else if (e instanceof PosApiError && e.codigo === 'SIN_CONEXION') {
          setPantalla({ tipo: 'sin-red' })
          return
        } else {
          // Otro error: la pantalla del PIN lo vuelve a intentar y lo muestra.
          setPantalla({ tipo: 'pin' })
          return
        }
      }
    }

    if (codigo) {
      try {
        const admin = await posApi.canjear(codigo)
        setPantalla({ tipo: 'habilitar', admin, aviso: null, cancelable: false })
      } catch (e) {
        setPantalla({ tipo: 'habilitar', admin: null, aviso: e instanceof PosApiError ? e.message : AVISO_REVOCADO, cancelable: false })
      }
      return
    }
    setPantalla({ tipo: 'habilitar', admin: null, aviso, cancelable: false })
  }, [guardarEquipo, olvidarEquipo])

  // Una sola vez: canjear el codigo lo gasta (StrictMode monta dos veces en desarrollo).
  useEffect(() => {
    if (arrancado.current) return
    arrancado.current = true
    void arrancar()
  }, [arrancar])

  const equipoInvalido = useCallback((motivo: string) => {
    olvidarEquipo()
    setPantalla({ tipo: 'habilitar', admin: null, aviso: motivo || AVISO_REVOCADO, cancelable: false })
  }, [olvidarEquipo])

  const entro = useCallback((s: SesionPos) => {
    // Las ventas abiertas son de cada empleado: antes de mostrar la pantalla,
    // las suyas (guardadas en este equipo), no las del que estaba antes.
    const caja = usePosStore.getState().equipo?.caja
    if (caja) useCarritoStore.getState().abrirVentasDe(caja.id, s.empleado.id)
    abrirSesion(s.token, s.empleado)
    setPantalla({ tipo: 'venta' })
  }, [abrirSesion])

  const bloqueada = useCallback(() => {
    cerrarSesion()
    setPantalla({ tipo: 'pin' })
  }, [cerrarSesion])

  // Venta sin sesion o sin equipo (se olvido el equipo, vencio la sesion): al PIN.
  useEffect(() => {
    if (pantalla.tipo === 'venta' && !(equipo && sesion)) setPantalla({ tipo: 'pin' })
  }, [pantalla.tipo, equipo, sesion])

  const listo = useCallback((e: EquipoGuardado) => {
    guardarEquipo(e)
    setPantalla({ tipo: 'pin' })
  }, [guardarEquipo])

  let contenido: JSX.Element
  switch (pantalla.tipo) {
    case 'cargando':
      contenido = <div className="pos-centro"><div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} /></div>
      break
    case 'habilitar':
      contenido = (
        <HabilitarEquipo
          adminInicial={pantalla.admin}
          aviso={pantalla.aviso}
          onListo={listo}
          onCancelar={pantalla.cancelable && equipo ? () => setPantalla({ tipo: 'pin' }) : undefined}
        />
      )
      break
    case 'pin':
      contenido = equipo
        ? <PinView equipo={equipo} onEntro={entro} onEquipoInvalido={equipoInvalido}
            onSinPos={(motivo) => setPantalla({ tipo: 'sin-pos', motivo })}
            onRehabilitar={() => setPantalla({ tipo: 'habilitar', admin: null, aviso: null, cancelable: true })} />
        : <HabilitarEquipo onListo={listo} />
      break
    case 'venta':
      contenido = equipo && sesion
        ? <VentaView equipo={equipo} sesion={sesion} onBloqueada={bloqueada} onEquipoInvalido={equipoInvalido} />
        : <div className="pos-centro"><div className="spinner" /></div>
      break
    case 'sin-pos':
    case 'sin-red':
      contenido = (
        <div className="pos-centro">
          <div className="pos-panel" style={{ textAlign: 'center' }}>
            <Icon name={pantalla.tipo === 'sin-red' ? 'wifi-off' : 'alert-triangle'} size={32} style={{ color: 'var(--danger)' }} />
            <h1 className="pos-titulo">{pantalla.tipo === 'sin-red' ? 'Sin conexión' : 'POS no disponible'}</h1>
            <p className="pos-sub">
              {pantalla.tipo === 'sin-red'
                ? 'No hay conexión con el servidor. Revisa el internet de este equipo. Mientras tanto no se puede emitir: usa el procedimiento de contingencia.'
                : pantalla.motivo}
            </p>
            <Btn variant="primary" className="pos-boton-grande" icon="refresh-cw" onClick={() => void arrancar()}>Reintentar</Btn>
          </div>
        </div>
      )
      break
  }

  return (
    <div className={'pos-root' + (pantalla.tipo === 'venta' ? ' en-venta' : '')}>
      {!enLinea && (
        <div className="pos-sin-red" role="alert">
          <Icon name="wifi-off" size={16} />
          Sin conexión. No se puede emitir: usa el procedimiento de contingencia.
        </div>
      )}
      {/* Envoltorio por pantalla: al cambiar (PIN, venta, habilitar...) entra con
          un fundido. Solo opacidad: un transform aquí movería los diálogos fijos. */}
      <div key={pantalla.tipo} className="pos-pantalla">{contenido}</div>
    </div>
  )
}
