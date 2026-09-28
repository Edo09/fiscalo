// Fechas en hora local. No usar toISOString() para "hoy": da la fecha UTC y
// RD es UTC-4 todo el año, así que de 20:00 a 23:59 ya sería mañana.

const p2 = (n: number) => String(n).padStart(2, '0')

/** Fecha local de `d` en 'YYYY-MM-DD'. */
export const isoLocal = (d: Date): string =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`

/** Hoy (hora local) en 'YYYY-MM-DD'. */
export const hoyLocal = (): string => isoLocal(new Date())

/** Ahora (hora local) en 'YYYY-MM-DD HH:MM:SS', el formato DATETIME del backend. */
export const ahoraLocal = (): string => {
  const d = new Date()
  return `${isoLocal(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}
