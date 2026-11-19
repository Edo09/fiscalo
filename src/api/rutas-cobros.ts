// Las rutas de la API de Cobros, para los DOS ámbitos que sirve el mismo módulo (api-gratex docs/modules/cobros.md):
//   /api/cobros          cada empresa cobra a SUS clientes.
//   /api/cobros-tenants  la plataforma cobra a sus tenants (las empresas que usan Fiscalpoint); solo cuentas de soporte.
// Mismas rutas bajo otro primer segmento, más el buscador de tenants. Es lo único que cambia entre los dos servicios,
// y vive aquí, sin dependencias, para probarlo con Node (scripts/test-cobros-tenants.ts) contra la tabla de rutas del servidor.
//
// Imports de valor por ruta relativa con .ts: Node carga este archivo tal cual.
import { qs } from './qs.ts'

export const BASE_COBROS = '/api/cobros'
export const BASE_COBROS_TENANTS = '/api/cobros-tenants'

/** Las rutas de un ámbito. `base` es '/api/cobros' o '/api/cobros-tenants'. */
export function rutasCobros(base: string) {
  return {
    lista: (params: Record<string, string | number | undefined> = {}) => `${base}${qs(params)}`,
    resumen: (dias?: number) => `${base}/resumen${qs({ dias })}`,
    recordatorios: (params: { dias?: number; cada?: number } = {}) => `${base}/recordatorios${qs({ ...params })}`,
    /** Solo existe en la plataforma: el directorio de tenants (GET .../clientes?query=&limite=&excluidos=1). */
    buscar: (query?: string, limite?: number, conExcluidos?: boolean) => `${base}/clientes${qs({ query, limite, excluidos: conExcluidos ? 1 : undefined })}`,
    /** Solo en la plataforma: quitar a un tenant de la lista de clientes, o devolverlo (PUT). */
    excluido: (clientId: number) => `${base}/clientes/${clientId}/excluido`,
    cliente: (clientId: number) => `${base}/clientes/${clientId}`,
    config: (clientId: number) => `${base}/clientes/${clientId}/config`,
    cobro: (id: number) => `${base}/${id}`,
    pagos: (cobroId: number) => `${base}/${cobroId}/pagos`,
    cancelar: (id: number) => `${base}/${id}/cancelar`,
    reabrir: (id: number) => `${base}/${id}/reabrir`,
    recordatorio: (cobroId: number) => `${base}/${cobroId}/recordatorios`,
    anularPago: (pagoId: number) => `${base}/pagos/${pagoId}/anular`,
  }
}

export type RutasCobros = ReturnType<typeof rutasCobros>
