// La fecha y la hora de RD "de ahora". Sin React ni '@/…': scripts/test-cobros.ts lo prueba con `node` tal cual.
//
// El servidor manda su hora ('AAAA-MM-DD HH:MM:SS', hora de RD) con el dashboard y los recordatorios. El
// navegador puede estar en otra zona horaria (soporte entra a las empresas desde donde esté) y entonces "hoy" no
// es el mismo día: un pago con la fecha del navegador le llega al servidor como "de mañana" y se rechaza. Para no
// quedarse con una hora vieja en una pestaña abierta mucho rato, a la hora del servidor se le suma el tiempo que
// pasó desde que se leyó.

export interface RelojRD {
  /** 'AAAA-MM-DD' */
  hoy: string
  /** 'AAAA-MM-DD HH:MM:SS' */
  ahora: string
}

/** 'AAAA-MM-DD HH:MM:SS' (la hora de pared de RD) como milisegundos de pared; null si no se entiende. */
function pared(texto: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(texto)
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
  // Date.UTC "arregla" lo que se pasa de rango (el mes 13, la hora 99): se compara de vuelta para rechazarlo.
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`) return null
  return ms
}

/**
 * La hora de RD ahora: la que dijo el servidor (`servidor`), leída en `leidoMs`, más lo que pasó hasta `ahoraMs`
 * (Date.now()). RD no cambia de hora en el año, así que sumar el tiempo transcurrido a la hora de pared es exacto.
 * null si lo que mandó el servidor no es una fecha y hora.
 */
export function relojDeServidor(servidor: string, leidoMs: number, ahoraMs: number): RelojRD | null {
  const base = pared(servidor)
  if (base === null) return null
  const iso = new Date(base + Math.max(0, ahoraMs - leidoMs)).toISOString()
  return { hoy: iso.slice(0, 10), ahora: `${iso.slice(0, 10)} ${iso.slice(11, 19)}` }
}
