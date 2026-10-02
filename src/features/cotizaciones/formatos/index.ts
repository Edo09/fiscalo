// Formatos de cotización por tenant (spec 2026-10-01 "formatos de
// cotización"). Cada empresa cotiza con su propio papel y sus propias reglas:
// Gratex con precios que ya traen ITBIS y su PDF de siempre; Ferretería con
// artículos del catálogo, ITBIS encima y cargos y abonos debajo del total.
//
// El formato del tenant lo decide el backend (master tenants.cotizacion_formato,
// expuesto en GET /api/branding) y el de una cotización guardada, su columna
// `formato`. Este registro solo dice qué formulario va con cada uno.
//
// Un formato nuevo: su carpeta aquí, una entrada en FormatoId y en FORMATOS, y
// su clase en api-gratex src/Utils/Cotizacion/ (CotizacionFormatos). El editor
// lo toma de este registro, pero el listado no: CotizacionesView elige las
// columnas y las acciones de cada fila por formato, y una fila de un formato
// que no esté allí sale con el Facturar de Gratex (precios con ITBIS incluido).
// Los pasos completos: api-gratex docs/modules/cotizaciones-formatos.md,
// "Agregar un formato para un tenant nuevo".
import type { ComponentType } from 'react'
import { getBranding } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Nav } from '@/config/navigation'
import { CotizacionFormView } from '../CotizacionFormView'
import { FerreteriaCotizacionForm } from './ferreteria/FerreteriaCotizacionForm'

export type FormatoId = 'gratex' | 'ferreteria'

export interface CotizacionFormatoUI {
  id: FormatoId
  /** Formulario de alta y edición. `cotizacionId` null = cotización nueva. */
  Form: ComponentType<{ nav: Nav; cotizacionId: number | null }>
}

export const FORMATOS: Record<FormatoId, CotizacionFormatoUI> = {
  // El formulario de siempre, sin tocar: Gratex no cambia con este registro.
  gratex: { id: 'gratex', Form: CotizacionFormView },
  ferreteria: { id: 'ferreteria', Form: FerreteriaCotizacionForm },
}

/** ¿Es un formato que esta versión del front sabe mostrar? */
export function esFormato(x: unknown): x is FormatoId {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(FORMATOS, x)
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

/**
 * Formato de cotización del tenant, para una cotización NUEVA y para elegir
 * las columnas del listado. Misma clave de caché que el resto de la app
 * (['branding']): si ya se pidió, no se vuelve a pedir.
 *
 * - `cargando`: todavía no hay dato. Quien llama espera; no supone Gratex,
 *   porque montar un formulario y cambiarlo por otro al llegar el dato
 *   perdería lo escrito.
 * - `formato`: 'gratex' solo si branding llegó sin el campo (backend sin
 *   desplegar) o con uno que este front no conoce, o si respondió 409 (abajo).
 * - `error`: no se pudo saber el formato (branding falló y no hay nada en
 *   caché). Un refresco fallido con el dato ya en caché no cuenta: el formato
 *   se sigue sabiendo.
 *
 * El 409 es el de una instalación single-tenant (MULTI_TENANT_ENABLED=false):
 * el branding vive en master.tenants y sin tenant GET /api/branding responde
 * 409 siempre, así que reintentar no cambia nada. Sin tenant el backend cotiza
 * con Gratex (CotizacionFormatos::delTenant): el 409 es una respuesta y no un
 * fallo, y la cotización nueva se abre con Gratex, como antes de los formatos.
 */
export function useCotizacionFormato(): { formato: FormatoId; cargando: boolean; error: string | null } {
  const { data, loading, error, errorStatus } = useApiQuery(['branding'], getBranding)
  const sinTenant = data == null && errorStatus === 409
  const crudo = data?.cotizacion_formato
  return {
    formato: esFormato(crudo) ? crudo : 'gratex',
    cargando: loading,
    error: data != null || sinTenant ? null : error,
  }
}
