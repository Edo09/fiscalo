// Datos de Cobros con TanStack Query: consultas (con su caché) y mutaciones. Toda mutación invalida la raíz del
// ámbito entera (['cobros'] o ['cobros-tenants']): un pago cambia a la vez la lista, el dashboard, el panel del cliente,
// los recordatorios y el siguiente cobro generado, y es más barato volver a pedirlos que acertar cuáles.
// El servicio y las claves salen del ÁMBITO de la pantalla (ambito.ts): los mismos hooks sirven a los cobros de una
// empresa a sus clientes y a los de la plataforma a sus tenants.
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  ApiCobros, CambiosCobroInput, ConfigCobroInput, ListarCobrosParams, NuevoCobroInput, PagoInput, RecordatorioInput, ResumenCobros,
} from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { ahoraLocal, hoyLocal } from '@/lib/date'
import { useAmbitoCobros } from './ambito'
import { MAX_DIRECTORIO } from './directorio'
import { relojDeServidor, type RelojRD } from './reloj'
import type { FiltrosCobros } from './store'

/** Ventana (días) de "vence pronto" y cada cuántos días se vuelve a recordar: los valores del servidor. */
export const DIAS_PROXIMOS = 7
export const DIAS_RECORDAR = 7

/** Los filtros de la pantalla como parámetros de la API (lo vacío no se manda). */
export function paramsDeFiltros(f: FiltrosCobros, page: number, pageSize: number): ListarCobrosParams {
  return {
    page,
    pageSize,
    query: f.query || undefined,
    client_id: f.clientId ?? undefined,
    estado: f.estado || undefined,
    periodo: f.periodo || undefined,
    vence_desde: f.venceDesde || undefined,
    vence_hasta: f.venceHasta || undefined,
  }
}

// --- Consultas --------------------------------------------------------------

export function useListaCobros(f: FiltrosCobros, page: number, pageSize: number) {
  const { api, keys } = useAmbitoCobros()
  const params = paramsDeFiltros(f, page, pageSize)
  return useApiQuery(keys.lista(params), () => api.listCobros(params), { keepPrevious: true })
}

export function useResumenCobros(dias = DIAS_PROXIMOS) {
  const { api, keys } = useAmbitoCobros()
  return useApiQuery(keys.resumen(dias), () => api.getResumenCobros(dias))
}

export function useRecordatoriosCobros(dias = DIAS_PROXIMOS, cada = DIAS_RECORDAR) {
  const { api, keys } = useAmbitoCobros()
  return useApiQuery(keys.recordatorios(dias, cada), () => api.getRecordatoriosCobros({ dias, cada }), { keepPrevious: true })
}

/** El panel de un cliente: configuración, resumen, cobros con sus pagos y recordatorios. */
export function usePanelCliente(clientId: number) {
  const { api, keys } = useAmbitoCobros()
  return useApiQuery(keys.cliente(clientId), () => api.getClienteCobros(clientId))
}

/**
 * Los tenants del buscador de la plataforma (solo en ese ámbito), por nombre o RNC. `texto` ya viene sin la demora de
 * teclear (el buscador la maneja); vacío = los primeros de la lista, los activos primero.
 */
export function useBuscarTenants(texto: string) {
  const { api, keys } = useAmbitoCobros()
  return useApiQuery(keys.buscar(texto), () => api.buscarTenants(texto, 20), { keepPrevious: true })
}

/**
 * El directorio de tenants (solo en la plataforma): todos, con su cobro mensual y lo que deben, para lo que se busca. Trae TAMBIÉN
 * a los marcados como "no es un cliente" (cada uno dice `excluido`): la pantalla decide si los muestra. `habilitado` false apaga la
 * consulta (la pantalla de una empresa no tiene directorio, y esa ruta no existe allí). El tope de una respuesta es MAX_DIRECTORIO;
 * con más empresas que eso, la búsqueda las alcanza.
 */
export function useDirectorioTenants(texto = '', habilitado = true) {
  const { api, keys } = useAmbitoCobros()
  return useApiQuery(keys.directorio(texto), () => api.buscarTenants(texto, MAX_DIRECTORIO, true), { keepPrevious: true, enabled: habilitado })
}

/**
 * El cobro para un FORMULARIO que toma su estado inicial al montarse (el monto por defecto de un pago, los campos de una edición):
 * como useDetalleCobro, pero `loading` sigue en true hasta que llega un dato FRESCO de esta apertura. Con el dato viejo de la caché
 * (de antes de cancelar o reabrir el cobro, de un pago de otro usuario…) el formulario arrancaba con valores que ya no valen (un pago de
 * RD$ 0.00, un monto de otro momento) y, al llegar el dato nuevo, no se corregían. Si el refetch falla, se usa el dato de la caché, con su
 * aviso; si no hay dato, es el error de siempre.
 */
export function useDetalleParaFormulario(id: number) {
  const q = useDetalleCobro(id)
  const [fresco, setFresco] = useState(false)
  useEffect(() => {
    if (q.data && !q.fetching) setFresco(true)
  }, [q.data, q.fetching])
  return { ...q, loading: q.loading || (q.data !== null && !fresco) }
}

/** Un cobro con todo su historial. Los formularios lo leen aquí para mostrar el saldo de AHORA. */
export function useDetalleCobro(id: number) {
  const { api, keys } = useAmbitoCobros()
  return useApiQuery(keys.detalle(id), () => api.getCobro(id))
}

/**
 * La fecha y la hora de RD de ahora. Salen de la hora que dijo el servidor con el dashboard (que está siempre en
 * pantalla; se lee de su caché, sin otra petición) y no del reloj del navegador, que puede estar en otra zona
 * horaria. Sin esa respuesta todavía, la del navegador. Devuelve una FUNCIÓN: se llama al pintar y otra vez al
 * guardar, para validar contra el "ahora" de ese momento y no contra el de cuando se abrió el formulario.
 */
export function useRelojServidor(): () => RelojRD {
  const qc = useQueryClient()
  const { keys } = useAmbitoCobros()
  return () => {
    const estado = qc.getQueryState<ResumenCobros>(keys.resumen(DIAS_PROXIMOS))
    const r = estado?.data ? relojDeServidor(estado.data.ahora, estado.dataUpdatedAt, Date.now()) : null
    return r ?? { hoy: hoyLocal(), ahora: ahoraLocal() }
  }
}

// --- Mutaciones -------------------------------------------------------------

function useMutacion<V, R>(fn: (api: ApiCobros, v: V) => Promise<R>) {
  const qc = useQueryClient()
  const { api, keys } = useAmbitoCobros()
  return useMutation({
    mutationFn: (v: V) => fn(api, v),
    // onSettled y no onSuccess: un 409 ("ya está pagado", "otro monto"), un 422 o un tiempo agotado ("puede que sí se
    // haya guardado") también dejan la pantalla con datos viejos, y la persona tiene que ver lo que hay AHORA para
    // decidir. Sin esperar el refetch: el resultado ya trae lo que la pantalla necesita para avisar.
    onSettled: () => { void qc.invalidateQueries({ queryKey: keys.todo }) },
  })
}

export const useCrearCobro = () => useMutacion((api, cobro: NuevoCobroInput) => api.createCobro(cobro))
export const useActualizarCobro = () =>
  useMutacion((api, { id, cambios }: { id: number; cambios: CambiosCobroInput }) => api.updateCobro(id, cambios))
export const useRegistrarPago = () =>
  useMutacion((api, { cobroId, pago }: { cobroId: number; pago: PagoInput }) => api.registrarPagoCobro(cobroId, pago))
export const useCancelarCobro = () =>
  useMutacion((api, { id, motivo }: { id: number; motivo?: string }) => api.cancelarCobro(id, motivo))
export const useReabrirCobro = () => useMutacion((api, id: number) => api.reabrirCobro(id))
export const useAnularPago = () =>
  useMutacion((api, { pagoId, motivo }: { pagoId: number; motivo?: string }) => api.anularPagoCobro(pagoId, motivo))
export const useGuardarConfig = () =>
  useMutacion((api, { clientId, config }: { clientId: number; config: ConfigCobroInput }) => api.guardarConfigCobro(clientId, config))
/** Quitar a un tenant de la lista de clientes (o devolverlo): invalida todo el ámbito, y con él el directorio y el buscador. */
export const useExcluirTenant = () =>
  useMutacion((api, { clientId, excluido, motivo }: { clientId: number; excluido: boolean; motivo?: string }) =>
    api.excluirTenant(clientId, excluido, motivo))
export const useRegistrarRecordatorio = () =>
  useMutacion((api, { cobroId, recordatorio }: { cobroId: number; recordatorio: RecordatorioInput }) =>
    api.registrarRecordatorioCobro(cobroId, recordatorio))
