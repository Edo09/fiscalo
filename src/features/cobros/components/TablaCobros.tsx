// La tabla principal de cobros: cliente, descripción y periodo, monto original, pagado, saldo, vencimiento,
// estado y acciones. Un clic en la fila abre el historial del cliente; "Cobrar" abre el pago.
import { toast } from 'sonner'
import { Avatar, Btn, Dropdown, Icon, MenuItem, Money } from '@/components/ui'
import { ApiError, type Cobro } from '@/api'
import { aCentavos } from '@/api/schemas/cobros'
import { admitePago, conceptoCobro, fechaCorta, periodoCorto, textoVencimiento } from '../format'
import { useReabrirCobro } from '../hooks'
import { useCobrosUi } from '../store'
import { EstadoCobroBadge } from './EstadoCobroBadge'

function AccionesFila({ c }: { c: Cobro }) {
  const abrirModal = useCobrosUi((s) => s.abrirModal)
  const abrirPanel = useCobrosUi((s) => s.abrirPanel)
  const reabrir = useReabrirCobro()
  const puedePagar = admitePago(c)

  const reabrirAhora = async () => {
    try {
      await reabrir.mutateAsync(c.id)
      toast.success(`Cobro de ${periodoCorto(c.periodo)} reabierto.`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo reabrir el cobro.')
    }
  }

  return (
    <span className="row gap-sm" style={{ justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
      {puedePagar && (
        <Btn variant="secondary" size="sm" icon="banknote" onClick={() => abrirModal({ tipo: 'pago', cobroId: c.id })}>
          Cobrar
        </Btn>
      )}
      <Dropdown
        align="right" width={230}
        trigger={<Btn variant="ghost" size="sm" icon="more-horizontal" aria-label={`Más acciones del cobro de ${c.cliente.nombre}`} />}
      >
        <MenuItem icon="user" onClick={() => abrirPanel(c.client_id)}>Ver cliente e historial</MenuItem>
        {c.estado !== 'Cancelado' && (
          <MenuItem icon="edit-3" onClick={() => abrirModal({ tipo: 'cobro', cobroId: c.id, clientId: c.client_id })}>Editar cobro</MenuItem>
        )}
        {puedePagar && (
          <MenuItem icon="bell" onClick={() => abrirModal({ tipo: 'recordatorio', cobroId: c.id })}>Anotar recordatorio</MenuItem>
        )}
        {puedePagar && !c.con_abonos && (
          <MenuItem icon="ban" danger onClick={() => abrirModal({ tipo: 'cancelar', cobroId: c.id })}>Cancelar cobro</MenuItem>
        )}
        {c.estado === 'Cancelado' && <MenuItem icon="repeat" onClick={reabrirAhora}>Reabrir cobro</MenuItem>}
      </Dropdown>
    </span>
  )
}

export function TablaCobros({ cobros }: { cobros: Cobro[] }) {
  const abrirPanel = useCobrosUi((s) => s.abrirPanel)
  const saldoPagina = cobros.reduce((a, c) => a + aCentavos(c.saldo), 0) / 100

  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Cliente</th><th>Descripción</th><th className="num">Monto</th><th className="num">Pagado</th>
            <th className="num">Saldo</th><th>Vencimiento</th><th>Estado</th><th style={{ width: 150 }}></th>
          </tr>
        </thead>
        <tbody>
          {cobros.map((c) => {
            const vence = textoVencimiento(c)
            return (
              <tr key={c.id} onClick={() => abrirPanel(c.client_id)}>
                <td>
                  <div className="row gap-sm">
                    <Avatar name={c.cliente.nombre} size={30} />
                    <div>
                      <span className="cell-main">{c.cliente.nombre}</span>
                      {c.cliente.contacto && c.cliente.contacto !== c.cliente.nombre && <div className="cell-sub">{c.cliente.contacto}</div>}
                    </div>
                  </div>
                </td>
                <td>
                  <span className="cell-main" style={{ fontWeight: 550 }}>{conceptoCobro(c)}</span>
                  <div className="cell-sub">
                    {periodoCorto(c.periodo)}
                    {c.generado_de_cobro_id !== null && <> · <Icon name="repeat" size={11} style={{ verticalAlign: '-1px' }} /> automático</>}
                  </div>
                </td>
                <td className="num muted"><Money value={c.monto} cur={false} /></td>
                <td className="num muted"><Money value={c.monto_pagado} cur={false} /></td>
                <td className="num fw6" style={c.estado === 'Vencido' ? { color: 'var(--danger)' } : undefined}>
                  <Money value={c.saldo} cur={false} />
                </td>
                <td>
                  <span className="text-sm">{fechaCorta(c.fecha_vencimiento)}</span>
                  {vence && <div className="cell-sub" style={c.estado === 'Vencido' ? { color: 'var(--danger)' } : undefined}>{vence}</div>}
                </td>
                <td>
                  <EstadoCobroBadge estado={c.estado} conAbonos={c.con_abonos} />
                  {c.estado === 'Cancelado' && c.motivo_cancelacion && <div className="cell-sub" title={c.motivo_cancelacion}>{c.motivo_cancelacion.slice(0, 28)}{c.motivo_cancelacion.length > 28 ? '…' : ''}</div>}
                </td>
                <td><AccionesFila c={c} /></td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: 'var(--surface-2)' }}>
            <td colSpan={4} className="fw6 text-sm" style={{ padding: '11px 14px' }}>Saldo de esta página ({cobros.length})</td>
            <td className="num fw6" style={{ padding: '11px 14px' }}><Money value={saldoPagina} cur={false} /></td>
            <td colSpan={3}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
