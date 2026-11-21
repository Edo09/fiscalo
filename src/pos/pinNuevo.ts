// Crear el PIN (api-gratex docs/specs/pos.md A5b): el usuario de FiscalPoint lo
// escribe y lo confirma. Es una pequeña máquina de estados pura, aparte de la
// pantalla (CrearPinView) para poder probarla sin navegador.
//
//   nuevo ──4 dígitos──▶ confirmar ──4 dígitos iguales──▶ listo (se manda al servidor)
//     ▲  │ obvio              │ distintos
//     └──┴────────────────────┘ se vuelve a empezar
//
// El servidor repite lo que importa (formato, PIN obvio, único en la empresa): lo de
// aquí solo ahorra el viaje y le dice a la persona qué pasó.

export const DIGITOS_PIN = 4

export type FasePin = 'nuevo' | 'confirmar'

export interface EstadoPin {
  fase: FasePin
  /** El PIN que se escribió en la fase 'nuevo' (vacío mientras se escribe). */
  primero: string
  /** Lo que se lleva escrito en esta fase (0 a DIGITOS_PIN dígitos). */
  actual: string
}

export type EventoPin =
  | { tipo: 'nada' }
  /** Los dos coinciden: mandarlo al servidor. */
  | { tipo: 'listo'; pin: string }
  /** 1234, 0000, 4321…: muy fácil de adivinar. */
  | { tipo: 'obvio' }
  /** La confirmación no es igual al primero. */
  | { tipo: 'no-coinciden' }

export const ESTADO_INICIAL: EstadoPin = { fase: 'nuevo', primero: '', actual: '' }

/**
 * Los PIN que cualquiera prueba primero: todos iguales o en escalera (sube o baja
 * de uno en uno). Es el mismo criterio de PosPin::esObvio en el servidor.
 */
export function pinEsObvio(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true
  let sube = true
  let baja = true
  for (let i = 1; i < pin.length; i++) {
    const paso = Number(pin[i]) - Number(pin[i - 1])
    sube = sube && paso === 1
    baja = baja && paso === -1
  }
  return sube || baja
}

/**
 * Aplica una tecla: un dígito, '⌫' (borra uno) o 'C' (borra lo que se lleva escrito
 * en esta fase). Con los DIGITOS_PIN completos los dígitos no suman: en 'confirmar'
 * eso es el PIN ya mandado, y no se puede seguir escribiendo mientras tanto.
 */
export function teclear(e: EstadoPin, tecla: string): { estado: EstadoPin; evento: EventoPin } {
  const igual = (estado: EstadoPin) => ({ estado, evento: { tipo: 'nada' } as EventoPin })
  if (tecla === '⌫') return igual({ ...e, actual: e.actual.slice(0, -1) })
  if (tecla === 'C') return igual({ ...e, actual: '' })
  if (!/^\d$/.test(tecla) || e.actual.length >= DIGITOS_PIN) return igual(e)

  const actual = e.actual + tecla
  if (actual.length < DIGITOS_PIN) return igual({ ...e, actual })

  if (e.fase === 'nuevo') {
    if (pinEsObvio(actual)) return { estado: ESTADO_INICIAL, evento: { tipo: 'obvio' } }
    return igual({ fase: 'confirmar', primero: actual, actual: '' })
  }
  if (actual === e.primero) return { estado: { ...e, actual }, evento: { tipo: 'listo', pin: actual } }
  return { estado: ESTADO_INICIAL, evento: { tipo: 'no-coinciden' } }
}

/** "Cambiar" en la confirmación: vuelve a escribir el primero. */
export function volverAEscribir(): EstadoPin {
  return ESTADO_INICIAL
}
