// El historial de cobros de un cliente: todos sus cobros, del más nuevo al más viejo, y al abrir uno, sus
// pagos (con los anulados a la vista, tachados). Las acciones son botones de ícono: dentro del panel lateral
// no se usa el menú desplegable, que quedaría detrás de él.
import { Fragment, useState } from 'react'
import { toast } from 'sonner'
import { Badge, Btn, EmptyState, Icon, Money } from '@/components/ui'
import { ApiError, type CobroConPagos } from '@/api'
import { ETIQUETA_METODO } from '@/api/schemas/cobros'
import { admitePago, conceptoCobro, fechaCorta, fechaHoraCorta, periodoCorto, textoVencimiento } from '../format'
import { useReabrirCobro } from '../hooks'
import { useCobrosUi } from '../store'
import { EstadoCobroBadge } from './EstadoCobroBadge'

export function HistorialCobros({ cobros, clientId }: { cobros: CobroConPagos[]; clientId: number }) {
  const abrirModal = useCobrosUi((s) => s.abrirModal)
  const reabrir = useReabrirCobro()
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set())

  const alternar = (id: number) => setAbiertos((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  const reabrirAhora = async (c: CobroConPagos) => {
    try {
      await reabrir.mutateAsync(c.id)
      toast.success(`Cobro de ${periodoCorto(c.periodo)} reabierto.`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo reabrir el cobro.')
    }
  }

  if (cobros.length === 0) {
    return (
      <EmptyState
        icon="wallet" title="Este cliente no tiene cobros"
        action={<Btn variant="primary" icon="plus" onClick={() => abrirModal({ tipo: 'cobro', cobroId: null, clientId })}>Nuevo cobro</Btn>}
      >
        Crea el primero, o configura su cobro mensual en la pestaña "Cobro mensual".
      </EmptyState>
    )
  }

  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 28 }}></th><th>Periodo</th><th>Vence</th><th className="num">Monto</th><th className="num">Pagado</th>
            <th className="num">Saldo</th><th>Estado</th><th style={{ width: 132 }}></th>
          </tr>
        </thead>
        <tbody>
          {cobros.map((c) => {
            const abierto = abiertos.has(c.id)
            const vence = textoVencimiento(c)
            const puedePagar = admitePago(c)
            return (
              <Fragment key={c.id}>
                <tr onClick={() => alternar(c.id)}>
                  <td>
                    <button
                      type="button" className="cobros-chevron" aria-expanded={abierto}
                      aria-label={`${abierto ? 'Ocultar' : 'Ver'} los pagos del cobro de ${periodoCorto(c.periodo)}`}
                      onClick={(e) => { e.stopPropagation(); alternar(c.id) }}
                    >
                      <Icon name={abierto ? 'chevron-down' : 'chevron-right'} size={15} />
                    </button>
                  </td>
                  <td>
                    <span className="cell-main">{periodoCorto(c.periodo)}</span>
                    <div className="cell-sub">{conceptoCobro(c)}{c.generado_de_cobro_id !== null ? ' · automático' : ''}</div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span className="text-sm">{fechaCorta(c.fecha_vencimiento)}</span>
                    {vence && <div className="cell-sub" style={c.estado === 'Vencido' ? { color: 'var(--danger)' } : undefined}>{vence}</div>}
                  </td>
                  <td className="num muted"><Money value={c.monto} cur={false} /></td>
                  <td className="num muted"><Money value={c.monto_pagado} cur={false} /></td>
                  <td className="num fw6" style={c.estado === 'Vencido' ? { color: 'var(--danger)' } : undefined}><Money value={c.saldo} cur={false} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <EstadoCobroBadge estado={c.estado} conAbonos={c.con_abonos} />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <span className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
                      {puedePagar && <Btn variant="ghost" size="sm" icon="banknote" title="Registrar pago" aria-label="Registrar pago" onClick={() => abrirModal({ tipo: 'pago', cobroId: c.id })} />}
                      {c.estado !== 'Cancelado' && <Btn variant="ghost" size="sm" icon="edit-3" title="Editar cobro" aria-label="Editar cobro" onClick={() => abrirModal({ tipo: 'cobro', cobroId: c.id, clientId })} />}
                      {puedePagar && <Btn variant="ghost" size="sm" icon="bell" title="Anotar recordatorio" aria-label="Anotar recordatorio" onClick={() => abrirModal({ tipo: 'recordatorio', cobroId: c.id })} />}
                      {puedePagar && !c.con_abonos && <Btn variant="ghost" size="sm" icon="ban" title="Cancelar cobro" aria-label="Cancelar cobro" style={{ color: 'var(--danger)' }} onClick={() => abrirModal({ tipo: 'cancelar', cobroId: c.id })} />}
                      {c.estado === 'Cancelado' && <Btn variant="ghost" size="sm" icon="repeat" title="Reabrir cobro" aria-label="Reabrir cobro" onClick={() => void reabrirAhora(c)} />}
                    </span>
                  </td>
                </tr>
                {abierto && (
                  <tr>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <div className="cobros-pagos">
                        {c.estado === 'Cancelado' && (
                          <p className="text-xs muted" style={{ margin: '4px 6px 8px' }}>
                            Cancelado el {fechaHoraCorta(c.cancelado_at ?? '')}{c.motivo_cancelacion ? `: ${c.motivo_cancelacion}` : ''}.
                          </p>
                        )}
                        {c.pagos.length === 0 ? (
                          <p className="text-sm muted" style={{ margin: '4px 6px' }}>Sin pagos registrados.</p>
                        ) : (
                          <table>
                            <thead><tr><th>Fecha</th><th>Método</th><th className="num">Monto</th><th>Observaciones</th><th></th></tr></thead>
                            <tbody>
                              {c.pagos.map((p) => (
                                <tr key={p.id} className={p.anulado ? 'anulado' : undefined}>
                                  <td>{fechaCorta(p.fecha_pago)}</td>
                                  <td>{ETIQUETA_METODO[p.metodo]}</td>
                                  <td className="num"><Money value={p.monto} cur={false} /></td>
                                  <td>{p.observaciones ?? '—'}</td>
                                  <td className="sin-tachar" style={{ textAlign: 'right' }}>
                                    {p.anulado
                                      ? <Badge tone="neutral" className="" >Anulado{p.motivo_anulacion ? `: ${p.motivo_anulacion}` : ''}</Badge>
                                      : <Btn variant="ghost" size="sm" icon="ban" title="Anular este pago" aria-label="Anular este pago" style={{ color: 'var(--danger)' }} onClick={() => abrirModal({ tipo: 'anular', pagoId: p.id, cobroId: c.id })}>Anular</Btn>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
