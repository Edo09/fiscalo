// Estados DGII de una factura e-CF (facturas.estado_dgii): la etiqueta corta que
// ve el usuario y las preguntas que hacen las pantallas (¿es un rechazo?, ¿está
// en vuelo?). Sin imports: scripts/check-errores.ts lo carga con `node` tal
// cual. El resto de la app lo usa desde '@/api' (mappers.ts lo re-exporta).

/** Etiqueta corta (reutiliza los tonos de EstadoBadge) para un estado DGII. */
const DGII_LABEL: Record<string, string> = {
  // Valor por defecto de la columna: ninguna emisión lo escribe (filas viejas).
  PENDIENTE: 'Pendiente',
  // En vuelo: la fila, el XML firmado y el e-NCF se guardaron antes de enviar a
  // la DGII y todavía no hay respuesta (EstadosEcf::EN_VUELO en la API).
  PENDIENTE_ENVIO: 'Por enviar',
  ENVIO_INCIERTO: 'Sin confirmar',
  ACEPTADO: 'Aceptado',
  RFCE_ACEPTADO: 'Aceptado',
  ACEPTADO_CONDICIONAL: 'Aceptado',
  RFCE_ACEPTADO_CONDICIONAL: 'Aceptado',
  ENVIADO: 'En proceso',
  EN_PROCESO: 'En proceso',
  RFCE_ENVIADO: 'En proceso',
  RFCE_EN_PROCESO: 'En proceso',
  RECHAZADO: 'Rechazado',
  RFCE_RECHAZADO: 'Rechazado',
  NO_ENCONTRADO: 'Pendiente',
  RFCE_NO_ENCONTRADO: 'Pendiente',
  ERROR: 'Error',
  RFCE_ERROR: 'Error',
  // Intentos archivados de un número que se volvió a emitir (e_ncf NULL).
  RECHAZADO_ARCHIVADO: 'Rechazado',
  NO_ENCONTRADO_ARCHIVADO: 'Rechazado',
  RFCE_RECHAZADO_ARCHIVADO: 'Rechazado',
  RFCE_NO_ENCONTRADO_ARCHIVADO: 'Rechazado',
  // Los mismos, cortados a 20 caracteres: un tenant sin modo estricto los pudo
  // guardar así antes de la migración 028 (VARCHAR(20) -> VARCHAR(40)).
  RFCE_ACEPTADO_CONDIC: 'Aceptado',
  RFCE_RECHAZADO_ARCHI: 'Rechazado',
  NO_ENCONTRADO_ARCHIV: 'Rechazado',
  RFCE_NO_ENCONTRADO_A: 'Rechazado',
}

/**
 * Estados de una factura guardada antes de enviarla a la DGII y todavía sin
 * respuesta: el número está ocupado y no se puede volver a emitir. Misma lista
 * que EstadosEcf::EN_VUELO en la API.
 */
export const ESTADOS_EN_VUELO = ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO'] as const

/** Etiqueta del estado; '—' si no hay; el código tal cual si no se conoce. */
export function dgiiLabel(raw?: string | null): string {
  if (!raw) return '—'
  return DGII_LABEL[raw] ?? raw
}

/** ¿El estado DGII es un rechazo (incluido RFCE)? */
export function isRechazo(raw?: string | null): boolean {
  return raw === 'RECHAZADO' || raw === 'RECHAZADO_ARCHIVADO' || raw === 'RFCE_RECHAZADO'
}

/** ¿La factura está en vuelo (guardada y firmada, sin respuesta de la DGII)? */
export function isEnVuelo(raw?: string | null): boolean {
  return (ESTADOS_EN_VUELO as readonly string[]).includes(raw ?? '')
}

/**
 * Estados desde los que la app deja usar "Reenviar a la DGII" (POST
 * /api/facturas/{id}/reenviar): solo un comprobante que la DGII rechazó o no
 * encontró. Uno sin confirmar (en vuelo, ENVIADO, EN_PROCESO) NUNCA se reenvía
 * desde la app: lo resuelve soporte o, en el POS, el reenvío automático. Mismos
 * estados que handleReenviar en la API.
 */
export const ESTADOS_REENVIABLES = ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO'] as const

/** ¿Se puede ofrecer "Reenviar a la DGII" para este estado? */
export function puedeReenviarEstado(raw?: string | null): boolean {
  return (ESTADOS_REENVIABLES as readonly string[]).includes(raw ?? '')
}
