// Los tres pasos del detalle de una factura (anexo 6.3): Guardada, Enviada a la DGII y la respuesta de la DGII, con la hora tal como está guardada (24 horas, sin cambiar de zona).
// Lo que decide este módulo es cuándo cada paso está hecho, pendiente o en alerta, y que la línea nunca diga que la DGII aceptó lo que no aceptó: lo incierto se ve incierto
// (el mismo cuidado que lib/acciones). Solo lo aceptado lleva hora en la respuesta; la hora del envío es la de `fechaEmisionDgii` en cuanto se sabe que se envió.
import { bucketDe } from '~/lib/etiquetas'
import type { Bucket } from '~/lib/etiquetas'
import { horaDe } from '~/lib/fechas'
import type { FacturaVista } from '~/lib/filas'
import { UMBRAL_CONSUMO } from '~/lib/tiposEcf'

export type PasoTiempo = {
  clave: 'guardada' | 'enviada' | 'respuesta'
  texto: string
  /** `HH:MM`, o null si no hay una hora que mostrar. */
  hora: string | null
  estado: 'hecho' | 'pendiente' | 'alerta'
}

/** Cómo se llama la respuesta y cómo está, por bucket. Solo lo aceptado es «hecho»; lo archivado terminó mal y va en alerta. */
const RESPUESTA: Record<Bucket, { texto: string; estado: PasoTiempo['estado'] }> = {
  aceptada: { texto: 'Aceptada', estado: 'hecho' },
  enProceso: { texto: 'En proceso', estado: 'pendiente' },
  sinConfirmar: { texto: 'Sin respuesta DGII', estado: 'alerta' },
  rechazada: { texto: 'Rechazada', estado: 'alerta' },
  noEncontrada: { texto: 'No encontrada', estado: 'alerta' },
  error: { texto: 'Error', estado: 'alerta' },
  reemplazada: { texto: 'Reemplazada', estado: 'alerta' },
}

/**
 * La línea de tiempo de una factura: siempre tres pasos, en este orden. «Enviada» está hecha con un track id (solo la DGII lo da al recibirlo), con un estado que ya pasó el
 * envío (lo que no es «sin confirmar») o con un estado `RFCE_` (el resumen de consumo pasa por el envío); si no, está pendiente y sin hora. Una E32 de menos de RD$250,000
 * aceptada nombra la respuesta «Resumen de consumo». Objetos nuevos en cada llamada.
 */
export function lineaTiempo(f: FacturaVista): PasoTiempo[] {
  const estado = typeof f.estado === 'string' ? f.estado : ''
  const bucket = bucketDe(estado)
  const aceptada = bucket === 'aceptada'
  const enviada = (typeof f.trackId === 'string' && f.trackId !== '') || estado.startsWith('RFCE_') || bucket !== 'sinConfirmar'
  const horaDgii = typeof f.fechaEmisionDgii === 'string' ? horaDe(f.fechaEmisionDgii) : null
  const respuesta = RESPUESTA[bucket]
  const resumen = aceptada && f.tipo === '32' && f.total < UMBRAL_CONSUMO
  return [
    { clave: 'guardada', texto: 'Guardada', hora: horaDe(f.fecha), estado: 'hecho' },
    { clave: 'enviada', texto: 'Enviada a la DGII', hora: enviada ? horaDgii : null, estado: enviada ? 'hecho' : 'pendiente' },
    { clave: 'respuesta', texto: resumen ? 'Resumen de consumo' : respuesta.texto, hora: aceptada ? horaDgii : null, estado: respuesta.estado },
  ]
}
