// Estado DGII de una venta del POS en palabras del cajero (ventas del turno y
// del día). Lo que no está aquí se muestra tal cual.
export const ESTADO_DGII: Record<string, string> = {
  RFCE_ACEPTADO: 'Aceptada', ACEPTADO: 'Aceptada', RFCE_ACEPTADO_CONDICIONAL: 'Aceptada', ACEPTADO_CONDICIONAL: 'Aceptada',
  RFCE_PENDIENTE: 'Sin confirmar DGII', ENVIO_PENDIENTE: 'Sin confirmar DGII', ENVIADO: 'DGII validando', EN_PROCESO: 'DGII validando',
  RFCE_RECHAZADO: 'Rechazada', RECHAZADO: 'Rechazada',
}

export function estadoDgii(estado: string): string {
  return ESTADO_DGII[estado] ?? estado
}

/** "9:41 a. m." de una fecha "2026-10-09 09:41:00". */
export function horaDe(fecha: string): string {
  const m = /[ T](\d{2}):(\d{2})/.exec(fecha)
  if (!m) return fecha
  const h = Number(m[1])
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'a. m.' : 'p. m.'}`
}

/** "jueves, 9 de octubre" de "2026-10-09". */
export function diaLargo(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' })
}
