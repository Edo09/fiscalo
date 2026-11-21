// FISCALO — POS (pos.fiscalpoint.com.do): que pantalla toca.
//
//   sin equipo guardado ............ Habilitar (login de admin o codigo del boton POS)
//   equipo guardado ................ PIN
//   equipo guardado + codigo del boton POS
//                                    quien viene es un usuario de FiscalPoint: se canjea el codigo
//                                    y se ve que le toca (A5b). Primera vez: crea su PIN ahi mismo
//                                    y entra. Ya lo tiene: el PIN, con un saludo. Sin acceso: el
//                                    PIN, con el motivo
//   "¿Primera vez? Usa tu usuario" (en el PIN)
//                                    usuario y clave de FiscalPoint: lo mismo que arriba
//   PIN correcto ................... Venta (con bloqueo de pantalla)
//   equipo revocado ................ Habilitar, con aviso
//   empresa sin POS ................ aviso, sin nada que hacer en este equipo
//
// La sesion de FiscalPoint de un usuario (codigo del boton o usuario y clave) solo sirve para
// identificarlo: se cierra (POST /api/auth/signout) en cuanto se sabe que le toca, salvo
// mientras crea su PIN, que la necesita para mandarlo.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Btn, Icon } from '@/components/ui'
import { posApi, PosApiError, type LoginAdmin, type MiAcceso, type SesionPos } from './api'
import { usePosStore, type EquipoGuardado } from './store'
import { useCarritoStore } from './carrito'
import { destinoTrasAcceso, salidaAlFallarCrearPin, type AvisoPin } from './accesoUsuario'
import { CrearPinView } from './CrearPinView'
import { HabilitarEquipo, PasoLogin } from './HabilitarEquipo'
import { PinView } from './PinView'
import { VentaView } from './VentaView'

type Pantalla =
  | { tipo: 'cargando' }
  | { tipo: 'habilitar'; admin: LoginAdmin | null; aviso: string | null; cancelable: boolean }
  | { tipo: 'pin'; aviso?: AvisoPin | null }
  /** Usuario y clave de FiscalPoint: para quien todavia no tiene PIN (o se lo restablecieron). */
  | { tipo: 'usuario'; aviso?: string | null }
  /** Primera vez de un usuario de FiscalPoint: elige su PIN. `usuario` es su sesion de FiscalPoint, que se cierra al salir de aqui. */
  | { tipo: 'crear-pin'; usuario: LoginAdmin; nombre: string }
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
const AVISO_ACCESO = 'No se pudo comprobar tu acceso desde FiscalPoint. Escribe tu PIN o entra con tu usuario.'
const AVISO_PIN_CREADO = 'Tu PIN quedó creado. Escríbelo para entrar.'

/** La sesion de FiscalPoint de quien se identifico solo servia para eso: se cierra sin esperar (si falla, vence sola). */
function cerrarUsuario(usuario: LoginAdmin): void {
  posApi.cerrarAdmin(usuario.token).catch(() => undefined)
}

export function PosApp() {
  const equipo = usePosStore((s) => s.equipo)
  const sesion = usePosStore((s) => s.sesion)
  const { guardarEquipo, olvidarEquipo, abrirSesion, cerrarSesion } = usePosStore.getState()
  const [pantalla, setPantalla] = useState<Pantalla>({ tipo: 'cargando' })
  const enLinea = useEnLinea()
  const arrancado = useRef(false)

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

  // Un fallo al identificar a un usuario que no se arregla en la pantalla donde estaba: al PIN, con lo que paso.
  const falloDeAcceso = useCallback((e: unknown) => {
    if (e instanceof PosApiError && e.codigo === 'SIN_CONEXION') {
      setPantalla({ tipo: 'sin-red' })
      return
    }
    setPantalla({ tipo: 'pin', aviso: { tono: 'aviso', texto: e instanceof PosApiError ? e.message : AVISO_ACCESO } })
  }, [])

  /**
   * Un usuario de FiscalPoint (`usuario`: su sesion) llego a este equipo: se ve que le toca (A5b) y se
   * lleva a esa pantalla. Si le toca crear su PIN, su sesion sigue viva hasta que termine; en cualquier
   * otro caso se cierra aqui. Lo que no se arregla en la pantalla donde estaba (equipo revocado, POS
   * apagado) lleva a la que si; el resto de los fallos se lanzan, y cada quien los muestra a su manera
   * (el formulario de usuario y clave, el aviso del PIN).
   */
  const evaluar = useCallback(async (eq: EquipoGuardado, usuario: LoginAdmin, avisarSiNoEntra: boolean): Promise<void> => {
    let acceso: MiAcceso
    try {
      acceso = await posApi.miAcceso(eq.token, usuario.token)
    } catch (e) {
      cerrarUsuario(usuario)
      if (e instanceof PosApiError && e.codigo === 'EQUIPO_NO_HABILITADO') {
        equipoInvalido(e.message)
        return
      }
      if (e instanceof PosApiError && (e.codigo === 'POS_INACTIVO' || e.codigo === 'EMPRESA_INACTIVA')) {
        setPantalla({ tipo: 'sin-pos', motivo: e.message })
        return
      }
      throw e
    }
    const destino = destinoTrasAcceso(acceso, avisarSiNoEntra)
    if (destino.destino === 'crear-pin') {
      setPantalla({ tipo: 'crear-pin', usuario, nombre: destino.nombre })
      return
    }
    cerrarUsuario(usuario)
    setPantalla({ tipo: 'pin', aviso: destino.aviso })
  }, [equipoInvalido])

  /**
   * El boton POS de FiscalPoint trajo a un usuario a un equipo que ya es una caja: se canjea su codigo
   * (una sesion suya, solo para identificarlo) y se ve que le toca. Nunca lanza: lo que falle va al PIN.
   */
  const entrarConCodigo = useCallback(async (eq: EquipoGuardado, codigo: string): Promise<void> => {
    let usuario: LoginAdmin
    try {
      usuario = await posApi.canjear(codigo)
    } catch (e) {
      // El codigo vale 60 s y una vez: sin el, se entra con el PIN o con el usuario y la clave.
      falloDeAcceso(e)
      return
    }
    try {
      await evaluar(eq, usuario, true)
    } catch (e) {
      falloDeAcceso(e)
    }
  }, [evaluar, falloDeAcceso])

  const arrancar = useCallback(async () => {
    setPantalla({ tipo: 'cargando' })
    const codigo = tomarCodigoDelHash()
    const guardado = usePosStore.getState().equipo
    let aviso: string | null = null

    if (guardado) {
      let vigente: EquipoGuardado | null = null
      try {
        const r = await posApi.estado(guardado.token)
        vigente = { ...guardado, caja: r.caja ?? guardado.caja, empresa: r.empresa.nombre }
        guardarEquipo(vigente)
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
      if (vigente) {
        // El equipo ya esta habilitado: el codigo del boton POS (si viene) es de un usuario que quiere entrar (A5b).
        if (codigo) await entrarConCodigo(vigente, codigo)
        else setPantalla({ tipo: 'pin' })
        return
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
  }, [guardarEquipo, olvidarEquipo, entrarConCodigo])

  // Una sola vez: canjear el codigo lo gasta (StrictMode monta dos veces en desarrollo).
  useEffect(() => {
    if (arrancado.current) return
    arrancado.current = true
    void arrancar()
  }, [arrancar])

  /**
   * El usuario escribio su PIN (dos veces igual). Se guarda y, si sale bien, entra al POS con el, sin
   * pedirlo otra vez. Lanza lo que se arregla escribiendo otro PIN (CrearPinView lo muestra y sigue);
   * lo demas cambia de pantalla (accesoUsuario.ts decide a cual).
   */
  const crearPin = useCallback(async (eq: EquipoGuardado, usuario: LoginAdmin, pin: string): Promise<void> => {
    try {
      await posApi.crearMiPin(eq.token, usuario.token, pin)
    } catch (e) {
      if (!(e instanceof PosApiError)) throw e
      const salida = salidaAlFallarCrearPin(e.codigo, e.message)
      if (salida.salida === 'reintentar') throw e
      cerrarUsuario(usuario)
      switch (salida.salida) {
        case 'equipo-invalido': equipoInvalido(e.message); break
        case 'sin-pos': setPantalla({ tipo: 'sin-pos', motivo: e.message }); break
        case 'usuario': setPantalla({ tipo: 'usuario', aviso: salida.aviso }); break
        case 'pin': setPantalla({ tipo: 'pin', aviso: salida.aviso }); break
      }
      return
    }
    // El PIN quedo guardado: ya no se puede "crear" otra vez, pase lo que pase ahora. La sesion de FiscalPoint cumplio.
    cerrarUsuario(usuario)
    try {
      entro(await posApi.entrar(eq.token, pin))
    } catch {
      // Si no entro (equipo bloqueado, caja inactiva, sin red...), el teclado del PIN sabe mostrarlo.
      setPantalla({ tipo: 'pin', aviso: { tono: 'info', texto: AVISO_PIN_CREADO } })
    }
  }, [entro, equipoInvalido])

  const bloqueada = useCallback(() => {
    cerrarSesion()
    setPantalla({ tipo: 'pin' })
  }, [cerrarSesion])

  // Venta sin sesion o sin equipo (se olvido el equipo, vencio la sesion): al PIN.
  useEffect(() => {
    if (pantalla.tipo === 'venta' && !(equipo && sesion)) setPantalla({ tipo: 'pin' })
  }, [pantalla.tipo, equipo, sesion])

  // El equipo acaba de quedar habilitado. Quien lo habilito es un usuario de FiscalPoint: si le toca
  // crear su PIN, ahora. Si no tiene acceso (soporte en la empresa de un cliente) no se le dice nada.
  const listo = useCallback((e: EquipoGuardado, usuario: LoginAdmin) => {
    guardarEquipo(e)
    setPantalla({ tipo: 'cargando' })
    evaluar(e, usuario, false).catch(falloDeAcceso)
  }, [guardarEquipo, evaluar, falloDeAcceso])

  // Al bloquear, cerrarSesion() (zustand) se pinta en un render ANTES que el
  // setPantalla('pin') que la acompaña: React no los junta. Con la venta sin
  // sesión se muestra ya el PIN, así ese render intermedio no deja ver un
  // spinner entre el diálogo y el teclado (y el PIN no se monta dos veces).
  const visible: Pantalla = pantalla.tipo === 'venta' && equipo && !sesion ? { tipo: 'pin' } : pantalla

  let contenido: JSX.Element
  switch (visible.tipo) {
    case 'cargando':
      contenido = <div className="pos-centro"><div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} /></div>
      break
    case 'habilitar':
      contenido = (
        <HabilitarEquipo
          adminInicial={visible.admin}
          aviso={visible.aviso}
          onListo={listo}
          onCancelar={visible.cancelable && equipo ? () => setPantalla({ tipo: 'pin' }) : undefined}
        />
      )
      break
    case 'pin':
      contenido = equipo
        ? <PinView equipo={equipo} aviso={visible.aviso ?? null} onEntro={entro} onEquipoInvalido={equipoInvalido}
            onSinPos={(motivo) => setPantalla({ tipo: 'sin-pos', motivo })}
            onRehabilitar={() => setPantalla({ tipo: 'habilitar', admin: null, aviso: null, cancelable: true })}
            onUsuario={() => setPantalla({ tipo: 'usuario' })} />
        : <HabilitarEquipo onListo={listo} />
      break
    case 'usuario':
      contenido = equipo
        ? <PasoLogin modo="usuario" aviso={visible.aviso ?? null}
            onEntro={(usuario) => evaluar(equipo, usuario, true)}
            onCancelar={() => setPantalla({ tipo: 'pin' })} />
        : <HabilitarEquipo onListo={listo} />
      break
    case 'crear-pin':
      contenido = equipo
        ? <CrearPinView nombre={visible.nombre}
            onCrear={(pin) => crearPin(equipo, visible.usuario, pin)}
            onCancelar={() => { cerrarUsuario(visible.usuario); setPantalla({ tipo: 'pin' }) }} />
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
            <Icon name={visible.tipo === 'sin-red' ? 'wifi-off' : 'alert-triangle'} size={32} style={{ color: 'var(--danger)' }} />
            <h1 className="pos-titulo">{visible.tipo === 'sin-red' ? 'Sin conexión' : 'POS no disponible'}</h1>
            <p className="pos-sub">
              {visible.tipo === 'sin-red'
                ? 'No hay conexión con el servidor. Revisa el internet de este equipo. Mientras tanto no se puede emitir: usa el procedimiento de contingencia.'
                : visible.motivo}
            </p>
            <Btn variant="primary" className="pos-boton-grande" icon="refresh-cw" onClick={() => void arrancar()}>Reintentar</Btn>
          </div>
        </div>
      )
      break
  }

  return (
    <div className={'pos-root' + (visible.tipo === 'venta' ? ' en-venta' : '')}>
      {!enLinea && (
        <div className="pos-sin-red" role="alert">
          <Icon name="wifi-off" size={16} />
          Sin conexión. No se puede emitir: usa el procedimiento de contingencia.
        </div>
      )}
      {/* Envoltorio por pantalla: al cambiar (PIN, venta, habilitar...) entra con
          un fundido. Solo opacidad: un transform aquí movería los diálogos fijos. */}
      <div key={visible.tipo} className="pos-pantalla">{contenido}</div>
    </div>
  )
}
