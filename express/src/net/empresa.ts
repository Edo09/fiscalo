// Las peticiones de Mi empresa y de Numeración: los datos de la empresa, los rangos autorizados y el alta de un rango. Son las mismas de la app completa (api/emisor.ts y api/ncf.ts),
// escritas aquí sobre `getJson` y `postJson` de http.ts para que el API las lea la lógica pura de lib/empresa.ts y no un tipo de la app completa. Devuelven lo que dice el API, sin leerlo.
import { getJson, postJson } from '@/api/http'

/** Las claves de la caché de consultas de estas dos pantallas (las estadísticas y los avisos, que también cambian al registrar un rango, son las de lib/lecturas). */
export const clavesEmpresa = {
  emisor: ['emisor'] as const,
  rangos: ['rangos'] as const,
}

/** Los datos fiscales de la empresa y, para una cuenta Express, el estado de su certificado (GET /api/emisor). */
export function getEmisor(): Promise<unknown> {
  return getJson<unknown>('/api/emisor')
}

/** Los rangos de e-NCF autorizados por la DGII del ambiente de la empresa (GET /api/ncf/rangos). */
export function getRangos(): Promise<unknown> {
  return getJson<unknown>('/api/ncf/rangos')
}

/** Registra un rango autorizado (POST /api/ncf/rangos; solo un administrador). El error 422 trae el texto que se le muestra a la persona. */
export function registrarRango(cuerpo: unknown): Promise<unknown> {
  return postJson<unknown>('/api/ncf/rangos', cuerpo)
}
