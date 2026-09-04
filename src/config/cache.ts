// Política de frescura de la caché de datos (TanStack Query).
//
// El problema que resuelve: un `staleTime` único para todo obliga a elegir entre
// una app que parpadea (todo se recarga siempre) y una que muestra datos viejos
// (nada se recarga). Ninguna de las dos es correcta, porque no todos los datos
// cambian al mismo ritmo:
//
//   - Las facturas y la bandeja de e-CF cambian SOLAS: la DGII responde un
//     acuse, otro usuario emite, alguien toca la base directamente. La app no se
//     entera por ningún evento, así que tiene que volver a preguntar seguido.
//   - Los clientes o los productos solo cambian cuando alguien los edita en la
//     app — y ahí ya se invalida la clave explícitamente. Preguntar seguido no
//     aporta nada.
//   - Los catálogos de la DGII (unidades de medida, provincias/municipios) no
//     cambian nunca durante una sesión.
//
// Por eso el `staleTime` sale del PREFIJO de la queryKey. Las vistas no cambian:
// useApiQuery lo resuelve solo. Para afinar el comportamiento de un recurso, se
// edita este archivo y nada más.

/** Cuánto tiempo un dato se considera fresco (no se vuelve a pedir). */
export const FRESCURA = {
  /** Cambia sin intervención del usuario: DGII, otro dispositivo, otro usuario. */
  VOLATIL: 20 * 1000,
  /** Cambia solo al editarlo en la app, donde además se invalida la clave. */
  NORMAL: 3 * 60 * 1000,
  /** Catálogos DGII: fijos durante toda la sesión. */
  CATALOGO: Infinity,
} as const

/**
 * Frescura por recurso (primer segmento de la queryKey).
 * Un recurso no listado usa NORMAL.
 */
const POR_RECURSO: Record<string, number> = {
  // --- Vuelven a cambiar por su cuenta -------------------------------------
  // El estado DGII de una factura pasa de ENVIADO a ACEPTADO/RECHAZADO de forma
  // asíncrona, sin que la app haga nada.
  facturas: FRESCURA.VOLATIL,
  'facturas-simples': FRESCURA.VOLATIL,
  gastos: FRESCURA.VOLATIL,
  // Los e-CF entrantes llegan empujados por la DGII: es una bandeja de entrada.
  'ecf-recibidos': FRESCURA.VOLATIL,
  // Los rangos e-NCF suelen registrarse por fuera (phpMyAdmin / otro operador).
  ncf: FRESCURA.VOLATIL,

  // --- Cambian solo al editarlos en la app ---------------------------------
  clients: FRESCURA.NORMAL,
  products: FRESCURA.NORMAL,
  proveedores: FRESCURA.NORMAL,
  categories: FRESCURA.NORMAL,
  warehouses: FRESCURA.NORMAL,
  cotizaciones: FRESCURA.NORMAL,
  users: FRESCURA.NORMAL,
  roles: FRESCURA.NORMAL,
  branding: FRESCURA.NORMAL,
  emisor: FRESCURA.NORMAL,
  reportes: FRESCURA.NORMAL,

  // --- Catálogos DGII ------------------------------------------------------
  'unidades-medida': FRESCURA.CATALOGO,
  ubicaciones: FRESCURA.CATALOGO,
}

/** staleTime que corresponde a una queryKey, por su primer segmento. */
export function staleTimeFor(key: readonly unknown[]): number {
  const recurso = typeof key[0] === 'string' ? key[0] : ''
  return POR_RECURSO[recurso] ?? FRESCURA.NORMAL
}
