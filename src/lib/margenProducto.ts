// Margen del formulario de producto: lo que queda sobre el precio después de restar el costo, en porcentaje
// con un decimal. Solo se muestra en pantalla: no se guarda ni viaja al API.
//
// Los dos valores llegan como texto, tal cual los tiene el formulario (pueden estar vacíos o a medio teclear):
// sin un precio y un costo mayores que 0 no hay margen que mostrar.

/** (precio − costo) / precio × 100 con un decimal; null si el precio o el costo no son números mayores que 0. */
export function margenDe(precio: string, costo: string): number | null {
  const p = Number(precio.trim())
  const c = Number(costo.trim())
  if (!Number.isFinite(p) || !Number.isFinite(c) || p <= 0 || c <= 0) return null
  return Math.round(((p - c) / p) * 1000) / 10
}

/** El margen como se ve en el formulario: "21.6 %", o "—" cuando no hay margen que mostrar. */
export function textoMargen(precio: string, costo: string): string {
  const m = margenDe(precio, costo)
  return m === null ? '—' : `${m.toFixed(1)} %`
}
