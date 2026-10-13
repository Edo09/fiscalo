// Los ids de formato, sin los formularios. Lo que solo necesita saber QUÉ
// formato es (useFormatoTenant, las acciones de una cotización) lo importa de
// aquí: index.ts importa los formularios, y un formulario que importara
// index.ts cerraría un ciclo. index.ts lo vuelve a exportar todo.

export type FormatoId = 'gratex' | 'ferreteria'

/** Un formato por clave: si FormatoId suma uno y aquí falta, no compila. */
const CONOCIDOS = { gratex: true, ferreteria: true } satisfies Record<FormatoId, true>

/** ¿Es un formato que esta versión del front sabe mostrar? */
export function esFormato(x: unknown): x is FormatoId {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(CONOCIDOS, x)
}

/**
 * Formato de una cotización guardada. Las filas de antes de la migración 026
 * no traen `formato` (o lo traen en null): son de Gratex. Uno desconocido
 * (un backend más nuevo que este front) también cae en Gratex.
 */
export function formatoDeFila(row: { formato?: string | null } | null | undefined): FormatoId {
  const f = row?.formato
  return esFormato(f) ? f : 'gratex'
}
