// Lo que Express sabe de la factura que se está haciendo o enviando, para quien lo muestra en cualquier pantalla (el punto del borrador y el aro de la
// barra, las franjas «Enviando factura...» y «Factura sin confirmar», el «Actualizar» de Más) y para quien no debe actuar en medio de un envío (el aviso
// de versión nueva, lib/version.ts).
//
// Los lee el asistente de venta (screens/facturar/useWizard.ts): carga lo guardado del usuario al montarse el shell, así que un envío sin confirmar se ve desde cualquier
// pantalla y también tras recargar. El tipo y la firma son los de siempre, porque la barra y las franjas del plan 06 ya los consumen.
import { useIndicadoresDelAsistente } from '~/screens/facturar/useWizard'

export type IndicadoresFacturar = {
  /** Hay un borrador de factura a medias en el teléfono. */
  borrador: boolean
  /** Hay una factura enviándose ahora mismo: su petición está en vuelo. */
  enviando: boolean
  /**
   * Hay una factura cuyo resultado no se conoce (el envío se cortó, o la DGII todavía no contesta): su e-NCF, el id de la factura si ya se guardó y la
   * clave de idempotencia de su registro. Es el registro abierto que la app no debe dejar atrás; null si no hay ninguno.
   */
  sinConfirmar: { eNcf: string; facturaId: number | null; clave: string } | null
}

/** Los indicadores de la factura de ahora: el mismo objeto mientras nada cambie, para quien los ponga en las dependencias de un efecto. */
export function useIndicadoresFacturar(): IndicadoresFacturar {
  return useIndicadoresDelAsistente()
}
