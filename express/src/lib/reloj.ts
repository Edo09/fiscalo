// El «hoy» de la app. Todo lo que dependa de la fecha del teléfono (el tile Hoy, «hoy» y «ayer», vencimientos) lo pide aquí y no a
// `new Date()` ni a `hoyLocal` de la app completa (el lint lo prohíbe): así la barra de desarrollo puede simular otra hora.
import { isoLocal } from '@/lib/date'

/** Cuánto se aparta el reloj simulado del real, en ms; null es el reloj real. Solo se escribe en DEV. */
let desfaseMs: number | null = null

/** `YYYY-MM-DD` a secas: `new Date` lo leería como medianoche UTC, que en RD (UTC-4) es la tarde del día anterior. */
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * Simula que el reloj del teléfono marca `iso` (hora local, `YYYY-MM-DDTHH:MM[:SS]`; sin hora, la medianoche local) y sigue corriendo
 * desde ahí, como el de un teléfono con la hora mal puesta. `null` devuelve el reloj real, y un texto que no es una fecha (el campo
 * vacío de la barra de desarrollo) también. Solo vale con `import.meta.env.DEV`: fuera de DEV no guarda nada y quita lo que hubiera, y
 * en el build de producción esa constante es `false` y el compilador descarta todo lo de aquí que la lee.
 */
export function setRelojSimulado(iso: string | null): void {
  if (iso === null || !import.meta.env.DEV) {
    desfaseMs = null
    return
  }
  const instante = new Date(SOLO_FECHA.test(iso) ? `${iso}T00:00:00` : iso).getTime()
  desfaseMs = Number.isNaN(instante) ? null : instante - Date.now()
}

/** La hora del teléfono: la real, o la simulada si es DEV y hay una. Una fecha nueva en cada llamada: quien la recibe puede cambiarla. */
export function ahora(): Date {
  return new Date(Date.now() + (import.meta.env.DEV && desfaseMs !== null ? desfaseMs : 0))
}

/** El día de hoy en hora local, `YYYY-MM-DD`: el único «hoy» de la app (nunca la fecha UTC de `toISOString`). */
export function hoy(): string {
  return isoLocal(ahora())
}
