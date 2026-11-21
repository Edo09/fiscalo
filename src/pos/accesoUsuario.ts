// Un usuario de FiscalPoint llega al POS (api-gratex docs/specs/pos.md A5b): qué pantalla
// le toca y qué hacer cuando crear su PIN no sale. Lógica pura, aparte de PosApp, para
// poder probarla sin navegador (scripts/test-pos-acceso-usuario.ts).
import type { MiAcceso } from './api'

/** Un recuadro sobre el teclado del PIN: `info` explica, `aviso` advierte. */
export interface AvisoPin {
  tono: 'info' | 'aviso'
  texto: string
}

export type DestinoAcceso =
  /** Sin PIN (primera vez o restablecido): elige su PIN aquí mismo. */
  | { destino: 'crear-pin'; nombre: string }
  /** Escribe el PIN que ya tiene (o, si no puede entrar, se le dice por qué). */
  | { destino: 'pin'; aviso: AvisoPin | null }

/**
 * Qué le toca a quien acaba de identificarse con su usuario de FiscalPoint.
 *
 * @param avisarSiNoEntra  si no puede usar el POS de esta empresa (es de otra, o le quitaron el
 *   acceso), ¿se le dice? Sí cuando él mismo lo pidió (el botón POS, su usuario y clave); no
 *   cuando solo habilitó el equipo (soporte lo hace en la caja de un cliente y no es un error).
 */
export function destinoTrasAcceso(acceso: MiAcceso, avisarSiNoEntra: boolean): DestinoAcceso {
  if (acceso.elegible && acceso.empleado) {
    if (!acceso.tiene_pin) return { destino: 'crear-pin', nombre: acceso.empleado.nombre }
    return { destino: 'pin', aviso: { tono: 'info', texto: `Hola, ${acceso.empleado.nombre}. Ya tienes PIN: escríbelo para entrar. Si lo olvidaste, un administrador puede restablecerlo.` } }
  }
  return {
    destino: 'pin',
    aviso: avisarSiNoEntra && acceso.mensaje ? { tono: 'aviso', texto: acceso.mensaje } : null,
  }
}

export type SalidaAlFallarCrearPin =
  /** Se arregla escribiendo otro PIN o volviendo a intentar: la pantalla de crear el PIN muestra el mensaje y sigue. */
  | { salida: 'reintentar' }
  /** El servidor ya no reconoce este equipo como caja. */
  | { salida: 'equipo-invalido' }
  /** La empresa ya no tiene el POS activo. */
  | { salida: 'sin-pos' }
  /** Venció la sesión de FiscalPoint de la persona: que entre otra vez con su usuario. */
  | { salida: 'usuario'; aviso: string }
  /** No se puede crear el PIN: de vuelta al teclado del PIN con este recuadro. */
  | { salida: 'pin'; aviso: AvisoPin }

const AVISO_SESION_VENCIDA = 'Tu sesión de FiscalPoint venció. Entra de nuevo con tu usuario.'
const AVISO_YA_TIENE_PIN = 'Ya tienes un PIN creado. Escríbelo para entrar; si no lo recuerdas, pídele a un administrador que lo restablezca.'

/**
 * Qué hacer cuando el servidor no deja crear el PIN. Lo que se arregla escribiendo otro PIN
 * (obvio, ya en uso, demasiados intentos, sin conexión, un tropiezo del servidor) se queda en
 * la pantalla de crearlo: ahí sigue el "Ahora no". Lo demás no tiene arreglo escribiendo otro
 * PIN y lleva a la pantalla que sí lo tiene.
 *
 * @param codigo   el `codigo` del servidor (PosApiError.codigo)
 * @param mensaje  su texto, para los casos en que se le muestra tal cual
 */
export function salidaAlFallarCrearPin(codigo: string, mensaje: string): SalidaAlFallarCrearPin {
  switch (codigo) {
    case 'EQUIPO_NO_HABILITADO':
      return { salida: 'equipo-invalido' }
    case 'POS_INACTIVO':
    case 'EMPRESA_INACTIVA':
      return { salida: 'sin-pos' }
    case 'USUARIO_NO_AUTENTICADO':
    case 'NO_AUTORIZADO':
      return { salida: 'usuario', aviso: AVISO_SESION_VENCIDA }
    case 'PIN_YA_CREADO':
      return { salida: 'pin', aviso: { tono: 'info', texto: AVISO_YA_TIENE_PIN } }
    case 'ACCESO_DESACTIVADO':
    case 'USUARIO_OTRA_EMPRESA':
    case 'EQUIPO_OTRA_EMPRESA':
      return { salida: 'pin', aviso: { tono: 'aviso', texto: mensaje } }
    default:
      return { salida: 'reintentar' }
  }
}
