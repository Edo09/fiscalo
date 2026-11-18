// La sección "Recordatorios": a QUÉ CLIENTES hay que recordarles un pago. Cada fila es un cliente con lo que
// debe vencido y lo que vence pronto, su último recordatorio (en cualquiera de sus cobros: una llamada cubre todo lo que
// debe), y si ya toca otro. Es INFORMATIVO: la app no envía mensajes ni correos; el recordatorio se hace por fuera y
// aquí solo se anota.
import { useMemo } from 'react'
import { Avatar, Badge, Btn, Card, EmptyState, ErrorState, KPI, LoadingState, Money } from '@/components/ui'
import { ETIQUETA_CANAL, type CanalRecordatorio } from '@/api/schemas/cobros'
import { cobrosTexto, diasTexto, fechaCorta, fechaHoraCorta, periodoCorto, resumenPeriodos } from '../format'
import { DIAS_RECORDAR, useRecordatoriosCobros } from '../hooks'
import { VENTANAS_RECORDATORIO, useCobrosUi } from '../store'
import { Aviso } from './Aviso'

export function RecordatoriosSection() {
  const abrirModal = useCobrosUi((s) => s.abrirModal)
  const abrirPanel = useCobrosUi((s) => s.abrirPanel)
  // La ventana vive en el store: el contador de la pestaña "Recordatorios" usa la MISMA que esta sección.
  const dias = useCobrosUi((s) => s.recordatoriosDias)
  const setDias = useCobrosUi((s) => s.setRecordatoriosDias)
  const { data, error, loading, fetching, reload } = useRecordatoriosCobros(dias, DIAS_RECORDAR)

  // Los cobros de cada cliente (para decir de qué meses es lo que debe).
  const periodos = useMemo(() => {
    const por = new Map<number, { vencidos: string[]; porVencer: string[] }>()
    for (const c of data?.items ?? []) {
      const e = por.get(c.client_id) ?? { vencidos: [], porVencer: [] }
      ;(c.motivo === 'vencido' ? e.vencidos : e.porVencer).push(c.periodo)
      por.set(c.client_id, e)
    }
    return por
  }, [data])

  return (
    <>
      <Aviso>
        Los recordatorios son solo informativos: Fiscalpoint no envía WhatsApp ni correos. Recuérdale el pago al cliente por
        el medio que uses y anótalo aquí para saber a quién ya le avisaste y cuándo.
      </Aviso>

      <div className="toolbar">
        <label className="row gap-sm text-sm muted">
          Incluir lo que vence en los próximos
          <select className="select" style={{ width: 'auto', padding: '5px 8px' }} value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            {VENTANAS_RECORDATORIO.map((d) => <option key={d} value={d}>{d} días</option>)}
          </select>
        </label>
        <span className="text-xs muted-3">
          Se le vuelve a recordar al cliente a los {DIAS_RECORDAR} días de su último recordatorio, o si le vence un cobro después de haberlo hecho.
        </span>
        {fetching && !loading && <span className="text-xs muted-3">Actualizando…</span>}
      </div>

      {data?.truncado && (
        <Aviso tono="error">
          Hay más cobros vencidos de los que caben en esta lista: se muestran los más atrasados y los totales son solo de lo que se muestra.
          Revisa el resto en la pestaña Cobros, filtrando por estado.
        </Aviso>
      )}

      {data && (
        <div className="kpi-grid compact" style={{ marginBottom: 14 }}>
          <KPI
            label="Clientes por recordar" value={data.resumen.clientes_por_recordar} icon="bell" iconBg="var(--warning-soft)" iconColor="var(--warning)"
            foot={`de ${data.resumen.clientes} ${data.resumen.clientes === 1 ? 'cliente' : 'clientes'} con algo vencido o por vencer`}
          />
          <KPI label="Ya recordados" value={data.resumen.clientes_recordados} icon="check-circle" iconBg="var(--success-soft)" iconColor="var(--success)" foot="clientes al día con el aviso" />
          <KPI label="Cobros vencidos" value={data.resumen.vencidos} icon="alert-triangle" iconBg="var(--danger-soft)" iconColor="var(--danger)" foot="ya pasaron su vencimiento" />
          <KPI label="Por vencer" value={data.resumen.por_vencer} icon="clock" foot={`cobros que vencen en ${dias} días o menos`} />
        </div>
      )}

      <Card noPad>
        {loading ? (
          <LoadingState rows={5} />
        ) : !data ? (
          <ErrorState title="No se pudieron cargar los recordatorios" onRetry={reload}>{error}</ErrorState>
        ) : data.clientes.length === 0 ? (
          <EmptyState icon="bell-off" title="Nada que recordar">Ningún cliente tiene cobros vencidos ni que venzan en los próximos {dias} días.</EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Cliente</th><th>Lo que debe</th><th>Último recordatorio</th><th style={{ width: 150 }}></th>
                </tr>
              </thead>
              <tbody>
                {data.clientes.map((c) => {
                  const u = c.ultimo
                  const meses = periodos.get(c.client_id)
                  return (
                    <tr key={c.client_id} onClick={() => abrirPanel(c.client_id)}>
                      <td>
                        <div className="row gap-sm">
                          <Avatar name={c.cliente.nombre} size={30} />
                          <div>
                            <span className="cell-main">{c.cliente.nombre}</span>
                            {c.cliente.telefono && <div className="cell-sub">{c.cliente.telefono}</div>}
                          </div>
                        </div>
                      </td>
                      <td>
                        {c.cobros_vencidos > 0 && (
                          <div>
                            <Badge tone="danger" dot>Vencido <Money value={c.saldo_vencido} cur={false} /></Badge>
                            <div className="cell-sub">
                              {cobrosTexto(c.cobros_vencidos)}{meses ? ` (${resumenPeriodos(meses.vencidos)})` : ''}
                              {c.mas_antiguo ? ` · desde el ${fechaCorta(c.mas_antiguo)}, hace ${diasTexto(c.dias_atraso)}` : ''}
                            </div>
                          </div>
                        )}
                        {c.cobros_por_vencer > 0 && (
                          <div style={c.cobros_vencidos > 0 ? { marginTop: 6 } : undefined}>
                            <Badge tone="warning" dot>Por vencer <Money value={c.saldo_por_vencer} cur={false} /></Badge>
                            <div className="cell-sub">
                              {cobrosTexto(c.cobros_por_vencer)}{meses ? ` (${resumenPeriodos(meses.porVencer)})` : ''}
                              {c.proximo_vencimiento ? ` · el próximo, el ${fechaCorta(c.proximo_vencimiento)}` : ''}
                            </div>
                          </div>
                        )}
                      </td>
                      <td>
                        {u ? (
                          <>
                            <span className="text-sm">{fechaHoraCorta(u.fecha_hora)}</span>
                            <div className="cell-sub" title={u.nota ?? undefined}>
                              {ETIQUETA_CANAL[u.canal as CanalRecordatorio] ?? u.canal}{u.usuario ? ` · ${u.usuario}` : ''} · cobro de {periodoCorto(u.periodo)}
                              {c.recordatorios > 1 ? ` · ${c.recordatorios} en total` : ''}
                            </div>
                          </>
                        ) : (
                          <span className="muted-3 text-sm">Nunca</span>
                        )}
                        {c.requiere_recordatorio
                          ? <div><Badge tone="warning">Toca recordar</Badge></div>
                          : <div><Badge tone="success">Recordado</Badge></div>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <span className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
                          <Btn
                            variant={c.requiere_recordatorio ? 'primary' : 'secondary'} size="sm" icon="bell"
                            title={`Se anota en el cobro de ${periodoCorto(c.periodo)}, el más urgente`}
                            onClick={() => abrirModal({ tipo: 'recordatorio', cobroId: c.cobro_id })}
                          >
                            Anotar
                          </Btn>
                          <Btn variant="ghost" size="sm" icon="user" title="Ver cliente e historial" aria-label={`Ver cliente e historial de ${c.cliente.nombre}`} onClick={() => abrirPanel(c.client_id)} />
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
