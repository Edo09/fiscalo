// Datos de Cobros con TanStack Query: consultas (con su caché) y mutaciones. Toda mutación invalida
// ['cobros'] entera: un pago cambia a la vez la lista, el dashboard, el panel del cliente, los
// recordatorios y el siguiente cobro generado, y es más barato volver a pedirlos que acertar cuáles.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  anularPagoCobro, cancelarCobro, createCobro, getClienteCobros, getCobro, getRecordatoriosCobros, getResumenCobros,
  guardarConfigCobro, listCobros, reabrirCobro, registrarPagoCobro, registrarRecordatorioCobro, updateCobro,
  type CambiosCobroInput, type ConfigCobroInput, type ListarCobrosParams, type NuevoCobroInput, type PagoInput,
  type RecordatorioInput, type ResumenCobros,
} from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { ahoraLocal, hoyLocal } from '@/lib/date'
import { relojDeServidor, type RelojRD } from './reloj'
import type { FiltrosCobros } from './store'

/** Ventana (días) de "vence pronto" y cada cuántos días se vuelve a recordar: los valores del servidor. */
export const DIAS_PROXIMOS = 7
export const DIAS_RECORDAR = 7

export const cobrosKeys = {
  todo: ['cobros'] as const,
  lista: (p: ListarCobrosParams) => ['cobros', 'lista', p] as const,
  resumen: (dias: number) => ['cobros', 'resumen', dias] as const,
  recordatorios: (dias: number, cada: number) => ['cobros', 'recordatorios', dias, cada] as const,
  cliente: (id: number) => ['cobros', 'cliente', id] as const,
  detalle: (id: number) => ['cobros', 'detalle', id] as const,
}

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
  const params = paramsDeFiltros(f, page, pageSize)
  return useApiQuery(cobrosKeys.lista(params), () => listCobros(params), { keepPrevious: true })
}

export function useResumenCobros(dias = DIAS_PROXIMOS) {
  return useApiQuery(cobrosKeys.resumen(dias), () => getResumenCobros(dias))
}

export function useRecordatoriosCobros(dias = DIAS_PROXIMOS, cada = DIAS_RECORDAR) {
  return useApiQuery(cobrosKeys.recordatorios(dias, cada), () => getRecordatoriosCobros({ dias, cada }), { keepPrevious: true })
}

/** El panel de un cliente: configuración, resumen, cobros con sus pagos y recordatorios. */
export function usePanelCliente(clientId: number) {
  return useApiQuery(cobrosKeys.cliente(clientId), () => getClienteCobros(clientId))
}

/** Un cobro con todo su historial. Los formularios lo leen aquí para mostrar el saldo de AHORA. */
export function useDetalleCobro(id: number) {
  return useApiQuery(cobrosKeys.detalle(id), () => getCobro(id))
}

/**
 * La fecha y la hora de RD de ahora. Salen de la hora que dijo el servidor con el dashboard (que está siempre en
 * pantalla; se lee de su caché, sin otra petición) y no del reloj del navegador, que puede estar en otra zona
 * horaria. Sin esa respuesta todavía, la del navegador. Devuelve una FUNCIÓN: se llama al pintar y otra vez al
 * guardar, para validar contra el "ahora" de ese momento y no contra el de cuando se abrió el formulario.
 */
export function useRelojServidor(): () => RelojRD {
  const qc = useQueryClient()
  return () => {
    const estado = qc.getQueryState<ResumenCobros>(cobrosKeys.resumen(DIAS_PROXIMOS))
    const r = estado?.data ? relojDeServidor(estado.data.ahora, estado.dataUpdatedAt, Date.now()) : null
    return r ?? { hoy: hoyLocal(), ahora: ahoraLocal() }
  }
}

// --- Mutaciones -------------------------------------------------------------

function useMutacion<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    // onSettled y no onSuccess: un 409 ("ya está pagado", "otro monto"), un 422 o un tiempo agotado ("puede que sí se
    // haya guardado") también dejan la pantalla con datos viejos, y la persona tiene que ver lo que hay AHORA para
    // decidir. Sin esperar el refetch: el resultado ya trae lo que la pantalla necesita para avisar.
    onSettled: () => { void qc.invalidateQueries({ queryKey: cobrosKeys.todo }) },
  })
}

export const useCrearCobro = () => useMutacion((cobro: NuevoCobroInput) => createCobro(cobro))
export const useActualizarCobro = () =>
  useMutacion(({ id, cambios }: { id: number; cambios: CambiosCobroInput }) => updateCobro(id, cambios))
export const useRegistrarPago = () =>
  useMutacion(({ cobroId, pago }: { cobroId: number; pago: PagoInput }) => registrarPagoCobro(cobroId, pago))
export const useCancelarCobro = () =>
  useMutacion(({ id, motivo }: { id: number; motivo?: string }) => cancelarCobro(id, motivo))
export const useReabrirCobro = () => useMutacion((id: number) => reabrirCobro(id))
export const useAnularPago = () =>
  useMutacion(({ pagoId, motivo }: { pagoId: number; motivo?: string }) => anularPagoCobro(pagoId, motivo))
export const useGuardarConfig = () =>
  useMutacion(({ clientId, config }: { clientId: number; config: ConfigCobroInput }) => guardarConfigCobro(clientId, config))
export const useRegistrarRecordatorio = () =>
  useMutacion(({ cobroId, recordatorio }: { cobroId: number; recordatorio: RecordatorioInput }) =>
    registrarRecordatorioCobro(cobroId, recordatorio))
