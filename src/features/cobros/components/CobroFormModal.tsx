// Crear o editar un cobro a mano. Al crear, el cliente se elige (o ya viene elegido desde su panel) y el
// formulario se rellena con lo que su configuración mensual sugiere: el periodo que sigue a su último
// cobro, el monto mensual y el vencimiento de su día. Lo que la persona toca ya no se pisa.
// Al editar: el periodo y el cliente no cambian; el monto no puede quedar por debajo de lo ya pagado.
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Avatar, Btn, ErrorState, LoadingState, Modal } from '@/components/ui'
import { ApiError, getClienteCobros, type CambiosCobroInput, type CobroDetalle, type NuevoCobroInput } from '@/api'
import {
  aCentavos, centavosDeTexto, cobroFormSchema, deCentavos, erroresPorCampo, esPeriodo, textoDinero, textoMontoCampo,
} from '@/api/schemas/cobros'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { ClientCombobox } from '@/features/clients/ClientCombobox'
import { periodoLargo, textoSiguiente, vencimientoDe } from '../format'
import { cobrosKeys, useActualizarCobro, useCrearCobro, useDetalleParaFormulario } from '../hooks'
import { useCobrosUi } from '../store'
import { Aviso } from './Aviso'

interface Props {
  /** null = crear. */
  cobroId: number | null
  /** Cliente ya elegido al crear (desde su panel); null = que se elija. */
  clientId: number | null
  onClose: () => void
}

export function CobroFormModal({ cobroId, clientId, onClose }: Props) {
  return cobroId === null
    ? <FormCobro cobro={null} errorActualizar={null} clientIdInicial={clientId} onClose={onClose} />
    : <EditarCobro cobroId={cobroId} onClose={onClose} />
}

function EditarCobro({ cobroId, onClose }: { cobroId: number; onClose: () => void }) {
  // Espera al dato fresco: los campos del formulario salen del cobro al montarse (con uno viejo, guardar pisaría el cambio de otro).
  const { data, error, loading, reload } = useDetalleParaFormulario(cobroId)
  if (loading) return <Modal title="Editar cobro" icon="edit-3" onClose={onClose}><LoadingState rows={3} /></Modal>
  // Solo un error SIN dato impide abrirlo: con dato (un refetch fallido) el formulario sigue y no pierde lo escrito.
  if (!data) {
    return (
      <Modal title="Editar cobro" icon="edit-3" onClose={onClose}>
        <ErrorState title="No se pudo abrir el cobro" onRetry={reload}>{error}</ErrorState>
      </Modal>
    )
  }
  return <FormCobro cobro={data} errorActualizar={error} clientIdInicial={data.client_id} onClose={onClose} />
}

interface Campos { periodo: string; fechaVencimiento: string; monto: string; descripcion: string }
type Campo = keyof Campos

function FormCobro({ cobro, errorActualizar, clientIdInicial, onClose }: {
  cobro: CobroDetalle | null; errorActualizar: string | null; clientIdInicial: number | null; onClose: () => void
}) {
  const editando = cobro !== null
  const abrirPanel = useCobrosUi((s) => s.abrirPanel)
  const crear = useCrearCobro()
  const actualizar = useActualizarCobro()
  const [clientId, setClientId] = useState<number | null>(clientIdInicial)
  const [form, setForm] = useState<Campos>(() => cobro
    ? { periodo: cobro.periodo, fechaVencimiento: cobro.fecha_vencimiento, monto: textoMontoCampo(aCentavos(cobro.monto)), descripcion: cobro.descripcion ?? '' }
    : { periodo: '', fechaVencimiento: '', monto: '', descripcion: '' })
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [duplicado, setDuplicado] = useState(false)
  const [saving, setSaving] = useState(false)
  // Los campos que la persona ya tocó: el valor sugerido por la configuración no los pisa.
  const tocados = useRef<Set<Campo>>(new Set())

  // Solo al crear: el panel del cliente trae su configuración y lo sugerido. Sin cliente elegido, la consulta no corre.
  const panel = useApiQuery(
    cobrosKeys.cliente(clientId ?? 0), () => getClienteCobros(clientId as number), { enabled: !editando && clientId !== null },
  )
  const sugerido = !editando && clientId !== null ? panel.data?.sugerido : undefined
  const config = panel.data?.config ?? null
  const nombreCliente = editando ? cobro.cliente.nombre : panel.data?.cliente.nombre

  useEffect(() => {
    if (!sugerido) return
    setForm((f) => {
      const periodo = tocados.current.has('periodo') ? f.periodo : sugerido.periodo
      return {
        periodo,
        // El vencimiento sin tocar sale del día del cliente y del periodo que HAY en el formulario (no del sugerido): si
        // la persona cambió el periodo antes de que llegara la sugerencia, no puede quedar un vencimiento de otro mes.
        fechaVencimiento: tocados.current.has('fechaVencimiento')
          ? f.fechaVencimiento
          : (config && esPeriodo(periodo) ? vencimientoDe(periodo, config.dia_vencimiento) : (sugerido.fecha_vencimiento ?? '')),
        monto: tocados.current.has('monto') ? f.monto : (sugerido.monto !== null ? textoMontoCampo(aCentavos(sugerido.monto)) : ''),
        descripcion: tocados.current.has('descripcion') ? f.descripcion : (sugerido.descripcion ?? ''),
      }
    })
  }, [sugerido, config])

  const cambiar = (campo: Campo, valor: string) => {
    tocados.current.add(campo)
    setErrores((e) => ({ ...e, [campo]: '' }))
    setDuplicado(false)
    setForm((f) => {
      const siguiente = { ...f, [campo]: valor }
      // Con configuración y sin tocar el vencimiento, cambiar el periodo mueve el vencimiento a su día.
      if (campo === 'periodo' && config && !tocados.current.has('fechaVencimiento') && esPeriodo(valor)) {
        siguiente.fechaVencimiento = vencimientoDe(valor, config.dia_vencimiento)
      }
      return siguiente
    })
  }

  const elegirOtroCliente = () => {
    tocados.current.clear()
    setClientId(null)
    setForm({ periodo: '', fechaVencimiento: '', monto: '', descripcion: '' })
    setError(null)
    setDuplicado(false)
  }

  const guardar = useAccionUnica(async () => {
    setError(null)
    setDuplicado(false)
    const parsed = cobroFormSchema.safeParse({ clientId, ...form })
    if (!parsed.success) { setErrores(erroresPorCampo(parsed.error)); return }
    setErrores({})
    const d = parsed.data
    const centavos = centavosDeTexto(d.monto) as number
    setSaving(true)
    try {
      if (cobro) {
        if (centavos < aCentavos(cobro.monto_pagado)) {
          setErrores({ monto: `El monto no puede ser menor a lo ya pagado (${textoDinero(aCentavos(cobro.monto_pagado))}).` })
          return
        }
        const cambios: CambiosCobroInput = {}
        if (centavos !== aCentavos(cobro.monto)) cambios.monto = deCentavos(centavos)
        if (d.fechaVencimiento !== cobro.fecha_vencimiento) cambios.fecha_vencimiento = d.fechaVencimiento
        if (d.descripcion !== (cobro.descripcion ?? '')) cambios.descripcion = d.descripcion
        if (Object.keys(cambios).length === 0) { toast.info('No hay cambios que guardar.'); onClose(); return }
        const r = await actualizar.mutateAsync({ id: cobro.id, cambios })
        const siguiente = textoSiguiente(r.siguiente_motivo, r.siguiente)
        toast.success(
          `Cobro de ${periodoLargo(cobro.periodo)} actualizado.${siguiente ? ` Quedó pagado. ${siguiente}` : ''}`,
        )
      } else {
        const body: NuevoCobroInput = {
          client_id: d.clientId, periodo: d.periodo, fecha_vencimiento: d.fechaVencimiento,
          monto: deCentavos(centavos), descripcion: d.descripcion || undefined,
        }
        const creado = await crear.mutateAsync(body)
        toast.success(`Cobro de ${periodoLargo(creado.periodo)} creado para ${creado.cliente.nombre}.`)
      }
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el cobro.')
      setDuplicado(e instanceof ApiError && e.codigo === 'COBRO_DUPLICADO')
    } finally {
      setSaving(false)
    }
  })

  const campo = (k: Campo, extra = '') => 'field' + extra + (errores[k] ? ' field-error' : '')
  const msg = (k: Campo) => errores[k] ? <div className="err-msg">{errores[k]}</div> : null

  return (
    <Modal
      title={editando ? 'Editar cobro' : 'Nuevo cobro'}
      sub={editando ? `${cobro.cliente.nombre} · ${periodoLargo(cobro.periodo)}` : 'Una cuenta por cobrar de un cliente'}
      icon={editando ? 'edit-3' : 'plus'} width={560} onClose={onClose} bloqueado={saving}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Btn>
          <Btn variant="primary" icon="save" onClick={() => void guardar()} disabled={saving || (!editando && clientId === null)}>
            {saving ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear cobro'}
          </Btn>
        </>
      }
    >
      {errorActualizar && <Aviso tono="error">No se pudo actualizar el cobro ({errorActualizar}). Se muestran los últimos datos que llegaron.</Aviso>}
      {error && (
        <>
          <Aviso tono="error">{error}</Aviso>
          {duplicado && clientId !== null && (
            <div className="mb-md">
              <Btn variant="secondary" size="sm" icon="user" onClick={() => { abrirPanel(clientId); onClose() }}>Ver los cobros de este cliente</Btn>
            </div>
          )}
        </>
      )}

      <div className="form-grid">
        <div className="field full">
          <label className="label">Cliente <span className="req">*</span></label>
          {clientId === null ? (
            <>
              <ClientCombobox
                value={null}
                onChange={(c) => { if (c) { tocados.current.clear(); setClientId(Number(c.id)) } }}
                invalido={!!errores.clientId}
              />
              {errores.clientId && <div className="err-msg">{errores.clientId}</div>}
            </>
          ) : (
            <div className="input row between" style={{ height: 'auto', padding: '8px 11px' }}>
              <span className="row gap-sm">
                <Avatar name={nombreCliente ?? '…'} size={30} />
                <span className="fw6 text-sm">{nombreCliente ?? 'Cargando…'}</span>
              </span>
              {!editando && <Btn variant="ghost" size="sm" onClick={elegirOtroCliente}>Cambiar</Btn>}
            </div>
          )}
          {!editando && clientId !== null && !panel.loading && !panel.error && (
            <div className="hint">
              {config
                ? `Cobro mensual ${config.activo ? 'activo' : 'inactivo'}: ${textoDinero(aCentavos(config.monto_mensual))} al mes, vence el día ${config.dia_vencimiento} (si el mes es más corto, el último día).`
                : 'Este cliente no tiene cobro mensual configurado: escribe el monto y el vencimiento. Puedes configurarlo en su panel.'}
            </div>
          )}
          {!editando && clientId !== null && panel.error && <div className="err-msg">{panel.error}</div>}
        </div>

        <div className={campo('periodo')}>
          <label className="label" htmlFor="cobro-periodo">Periodo <span className="req">*</span></label>
          <input
            id="cobro-periodo" className="input" type="month" value={form.periodo} disabled={editando}
            placeholder="AAAA-MM" pattern="\d{4}-\d{2}"
            onChange={(e) => cambiar('periodo', e.target.value)}
          />
          {msg('periodo')}
          {editando && <div className="hint">El periodo de un cobro no se cambia.</div>}
        </div>
        <div className={campo('fechaVencimiento')}>
          <label className="label" htmlFor="cobro-vence">Vencimiento <span className="req">*</span></label>
          <input
            id="cobro-vence" className="input" type="date" value={form.fechaVencimiento}
            onChange={(e) => cambiar('fechaVencimiento', e.target.value)}
          />
          {msg('fechaVencimiento')}
        </div>
        <div className={campo('monto')}>
          <label className="label" htmlFor="cobro-monto">Monto <span className="req">*</span></label>
          <div className="input-group">
            <span className="input-prefix">RD$</span>
            <input
              id="cobro-monto" className="input" inputMode="decimal" placeholder="0.00" value={form.monto} autoFocus={editando}
              onChange={(e) => cambiar('monto', e.target.value)}
            />
          </div>
          {msg('monto')}
          {editando && cobro.monto_pagado > 0 && (
            <div className="hint">
              Ya se pagaron {textoDinero(aCentavos(cobro.monto_pagado))}: el monto no puede ser menor. Si con eso el cliente quedó al día,
              baja el monto a {textoDinero(aCentavos(cobro.monto_pagado))} y el cobro queda pagado.
            </div>
          )}
        </div>
        <div className={campo('descripcion')}>
          <label className="label" htmlFor="cobro-desc">Descripción <span className="opt">(opcional)</span></label>
          <input
            id="cobro-desc" className="input" value={form.descripcion} maxLength={150} placeholder="Mensualidad, servicio…"
            onChange={(e) => cambiar('descripcion', e.target.value)}
          />
          {msg('descripcion')}
        </div>
      </div>

      <p className="text-xs muted-3" style={{ marginTop: 4 }}>
        {editando
          ? 'Cambiar el monto aquí solo afecta a este cobro: no modifica el monto mensual configurado del cliente ni los demás cobros.'
          : 'Este monto es solo de este cobro. El monto mensual del cliente se configura en su panel y no cambia los cobros ya creados.'}
      </p>
    </Modal>
  )
}
