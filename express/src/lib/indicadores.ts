// Lo que Express sabe de la factura que se está haciendo o enviando, para quien lo muestra en cualquier pantalla (el punto del borrador y el aro de la
// barra, las franjas «Enviando factura...» y «Factura sin confirmar», el «Actualizar» de Más) y para quien no debe actuar en medio de un envío (el aviso
// de versión nueva, lib/version.ts).
//
// Por ahora es un relleno: no hay borrador ni nada en vuelo. El plan 07 reemplaza el cuerpo de `useIndicadoresFacturar` (que leerá `borrador` y `envio`) y
// deja el tipo y la firma como están, porque la barra y las franjas del plan 06 ya los consumen.

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

/** El mismo objeto en cada llamada: quien lo ponga en las dependencias de un efecto no lo vuelve a ejecutar sin motivo. */
const SIN_INDICADORES: IndicadoresFacturar = { borrador: false, enviando: false, sinConfirmar: null }

/** Los indicadores de la factura de ahora. Relleno hasta el plan 07: sin borrador, nada en vuelo y nada sin confirmar. */
export function useIndicadoresFacturar(): IndicadoresFacturar {
  return SIN_INDICADORES
}
