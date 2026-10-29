// Las fechas del API, en texto, leídas por sus números. El API manda DATE (`2027-12-31`) y DATETIME (`2026-10-26 09:41:00`) en la hora del
// servidor, que es la de RD: aquí no se cambian de zona ni se le pasan a `Date` como texto, porque `new Date('2027-12-31')` es la medianoche
// UTC y en RD (UTC-4) cae en la tarde del 30: un vencimiento se leería un día antes (el fallo de `formatApiDate` en la app completa, que por
// eso no entra a Express). Los días se cuentan con aritmética entera sobre el calendario (días desde 1970-01-01 en UTC, que no tiene cambios
// de hora), así que el resultado es el mismo en cualquier zona del teléfono. «Hoy» sale de lib/reloj, el único «hoy» de la app.
import { hoy as hoyDelReloj } from '~/lib/reloj'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MS_POR_DIA = 86_400_000

/** `YYYY-MM-DD`: la fecha sola o los 10 primeros caracteres de un DATETIME. */
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/
/** La hora de un DATETIME (`YYYY-MM-DD HH:MM[:SS]`, con espacio o con T), con `HH` y `MM` ya separados. */
const HORA = /^\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2})/

/** Un día del calendario: sus partes, y `n`, los días enteros que van desde 1970-01-01. */
interface Dia {
  anio: number
  mes: number
  dia: number
  n: number
}

/**
 * El día de un `YYYY-MM-DD` (o de un DATETIME, por sus 10 primeros caracteres); null si no es un día del calendario: el 31 de abril, el 30
 * de febrero, el `0000-00-00` que MySQL guarda en un DATE sin valor.
 */
function leerDia(texto: string): Dia | null {
  const m = FECHA.exec(texto.slice(0, 10))
  if (m === null) return null
  const anio = Number(m[1])
  const mes = Number(m[2])
  const dia = Number(m[3])
  // Un `Date` armado con los números y leído en UTC, nunca con el texto. `setUTCFullYear` y no `Date.UTC`, que toma el año 50 por 1950.
  const fecha = new Date(0)
  fecha.setUTCFullYear(anio, mes - 1, dia)
  // Un día que no existe se desborda al mes siguiente (el 30 de febrero queda en marzo; el día 0, en el mes anterior) y un mes que no existe,
  // al año siguiente: en todos esos casos el mes ya no es el pedido, y mirarlo basta (tests/fechas.test.ts recorre el calendario).
  if (fecha.getUTCMonth() !== mes - 1) return null
  return { anio, mes, dia, n: fecha.getTime() / MS_POR_DIA }
}

/**
 * `2027-12-31` es `31 dic 2027`: el día sin cero a la izquierda, el mes abreviado y el año. Lee los 10 primeros caracteres, así que un
 * DATETIME también sirve. Lo que no es una fecha del calendario se devuelve tal cual, sin lanzar.
 */
export function fmtFechaISO(iso: string): string {
  const d = leerDia(iso)
  return d === null ? iso : `${d.dia} ${MESES[d.mes - 1]} ${d.anio}`
}

/**
 * Cuántos días faltan de `hoy` a `iso`: 1 es mañana, 0 es hoy y -7 es hace una semana. Es un entero, y no depende de la zona del teléfono.
 * `hoy` es el de lib/reloj si no se pasa. NaN si alguna de las dos no es una fecha del calendario: quien la usa decide qué hacer.
 */
export function diasHasta(iso: string, hoy: string = hoyDelReloj()): number {
  const d = leerDia(iso)
  const h = leerDia(hoy)
  return d === null || h === null ? NaN : d.n - h.n
}

/**
 * La hora de un DATETIME como `HH:MM` (`2026-10-27 10:42:00` es `10:42`), tal como viene, en 24 horas. Null si no hay una hora que mostrar:
 * una fecha sola, un texto que no es un DATETIME o una hora que no existe.
 */
export function horaDe(datetime: string): string | null {
  const m = HORA.exec(datetime)
  if (m === null || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return `${m[1]}:${m[2]}`
}

/**
 * El momento de una fila de la lista: `hoy 10:42`, `ayer 08:15`, `26 oct 09:41` si es de este año y `26 oct 2025 09:41` si no. «Hoy» y «ayer»
 * son los de la fecha local (`hoy`, por defecto el de lib/reloj). Sin hora (una fecha sola) no se escribe la hora, y lo que no es una fecha
 * del calendario se devuelve tal cual.
 */
export function etiquetaDia(datetime: string, hoy: string = hoyDelReloj()): string {
  const d = leerDia(datetime)
  if (d === null) return datetime
  const hora = horaDe(datetime)
  const sufijo = hora === null ? '' : ` ${hora}`
  const h = leerDia(hoy)
  if (h !== null) {
    if (d.n === h.n) return `hoy${sufijo}`
    if (d.n === h.n - 1) return `ayer${sufijo}`
  }
  return `${d.dia} ${MESES[d.mes - 1]}${h !== null && h.anio === d.anio ? '' : ` ${d.anio}`}${sufijo}`
}
