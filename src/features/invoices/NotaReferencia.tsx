// Bloque "Comprobante que modifica" de las notas E33/E34 (InformacionReferencia
// DGII): la factura original, qué corrige la nota y la razón.
import { useEffect, useState } from 'react'
import { Icon, Modal, Money, Spinner } from '@/components/ui'
import { formatApiDate, listFacturasModificables } from '@/api'
import type { CodigoModificacion, FacturaModificableRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { CODIGOS_MODIFICACION, ECF_TIPOS } from '@/config/ecf'
import { RAZON_NOTA_MAX, type ReferenciaErrors, type ReferenciaNotaForm } from './factura.schema'

const nombreTipo = (tipo: string) => ECF_TIPOS.find((t) => t.code === tipo)?.nombre ?? `e-CF ${tipo}`

/**
 * La factura sale de las aceptadas del cliente (no se escribe a mano): así el
 * e-NCF y la fecha son los que tiene la DGII, y el monto de una nota de crédito
 * se puede comparar con lo que le queda por acreditar.
 */
export function NotaReferencia({
  tipo, clienteId, value, errors, onChange,
}: {
  tipo: '33' | '34'
  /** Cliente de la nota: solo se listan SUS facturas. */
  clienteId: string | null
  value: ReferenciaNotaForm
  errors?: ReferenciaErrors
  onChange: (patch: Partial<ReferenciaNotaForm>) => void
}) {
  const [eligiendo, setEligiendo] = useState(false)
  const esCredito = tipo === '34'
  const nota = esCredito ? 'nota de crédito' : 'nota de débito'
  const { original } = value
  const ejemplo = CODIGOS_MODIFICACION.find((c) => c.code === value.codigo)?.ejemplo
  const razonLargo = value.razon.trim().length

  return (
    <section className="fx-nota-ref" aria-label="Comprobante que modifica">
      <span className="fx-eyebrow">Comprobante que modifica <span className="req">*</span></span>

      <div className="fx-nota-ref-grid">
        <div className="fx-nota-ref-campo">
          <span className="fx-nota-ref-label">Factura</span>
          {original ? (
            <button
              type="button"
              className={'fx-nota-ref-elegida' + (errors?.original || errors?.monto ? ' fx-nota-ref-elegida--err' : '')}
              onClick={() => setEligiendo(true)}
              aria-label={`Factura ${original.e_ncf}. Cambiar`}
            >
              <span className="mono fw6">{original.e_ncf}</span>
              <span className="text-xs muted">
                {nombreTipo(original.tipo_ecf)} · {formatApiDate(original.fecha_emision)} · <Money value={original.total} />
              </span>
              {esCredito && (original.notas_credito > 0 || original.notas_debito > 0) && (
                <span className="text-xs muted">Queda por acreditar <Money value={original.saldo} /></span>
              )}
              <span className="fx-link-btn fx-nota-ref-cambiar">Cambiar</span>
            </button>
          ) : (
            <button
              type="button"
              className={'fx-add fx-nota-ref-elegir' + (errors?.original ? ' fx-nota-ref-elegir--err' : '')}
              onClick={() => setEligiendo(true)}
              disabled={!clienteId}
            >
              <Icon name="search" size={14} />Elegir factura…
            </button>
          )}
          {!clienteId && !original && !errors?.original && (
            <span className="text-xs muted-3">Elige primero el cliente: se listan sus facturas aceptadas.</span>
          )}
          {errors?.original && <span className="fx-err"><Icon name="alert-circle" size={12} />{errors.original}</span>}
          {errors?.monto && <span className="fx-err"><Icon name="alert-circle" size={12} />{errors.monto}</span>}
        </div>

        <label className="fx-nota-ref-campo">
          <span className="fx-nota-ref-label">Qué corrige</span>
          <select
            className={'fx-cond-sel' + (errors?.codigo ? ' fx-cond-sel--err' : '')}
            value={value.codigo}
            onChange={(e) => onChange({ codigo: e.target.value as CodigoModificacion | '' })}
          >
            <option value="" disabled>Elige…</option>
            {CODIGOS_MODIFICACION.map((c) => <option key={c.code} value={c.code}>{c.nombre}</option>)}
          </select>
          {errors?.codigo && <span className="fx-err"><Icon name="alert-circle" size={12} />{errors.codigo}</span>}
        </label>

        <label className="fx-nota-ref-campo fx-nota-ref-razon">
          <span className="fx-nota-ref-label">Razón</span>
          <input
            className={'fx-field fx-field-visible' + (errors?.razon ? ' fx-field--err' : '')}
            value={value.razon}
            placeholder={ejemplo ?? `Por qué se emite esta ${nota}`}
            onChange={(e) => onChange({ razon: e.target.value })}
          />
          <span className={'fx-contador' + (razonLargo > RAZON_NOTA_MAX ? ' fx-contador--tope' : '')}>
            {razonLargo}/{RAZON_NOTA_MAX}
          </span>
          {errors?.razon && <span className="fx-err"><Icon name="alert-circle" size={12} />{errors.razon}</span>}
        </label>
      </div>

      {/* registrarVenta: el E34 devuelve al almacén lo que tenga producto del
          catálogo y el E33 lo saca. Un descuento con el producto enlazado
          movería inventario que nadie devolvió. */}
      <p className="fx-nota-ref-pie text-xs muted-3">
        {esCredito
          ? 'Las líneas con productos del catálogo vuelven al inventario. Para un descuento o un ajuste de precio, usa una línea de descripción.'
          : 'Las líneas con productos del catálogo salen del inventario. Para un cargo extra, usa una línea de descripción.'}
      </p>

      {eligiendo && clienteId && (
        <Modal
          title="Elegir la factura que modifica"
          sub={`Facturas del cliente aceptadas por la DGII · ${esCredito ? 'Nota de crédito' : 'Nota de débito'}`}
          icon="file-text"
          width={600}
          onClose={() => setEligiendo(false)}
        >
          <ListaModificables
            clienteId={clienteId}
            esCredito={esCredito}
            elegida={original?.e_ncf ?? null}
            onElegir={(f) => { onChange({ original: f }); setEligiendo(false) }}
          />
        </Modal>
      )}
    </section>
  )
}

/** Se monta solo con el modal abierto: la consulta no corre mientras no se busca. */
function ListaModificables({
  clienteId, esCredito, elegida, onElegir,
}: {
  clienteId: string
  esCredito: boolean
  elegida: string | null
  onElegir: (f: FacturaModificableRow) => void
}) {
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const lista = useApiQuery(
    ['facturas', 'modificables', clienteId, qDebounced],
    () => listFacturasModificables(Number(clienteId), qDebounced || undefined),
    { keepPrevious: true },
  )
  const filas = lista.data ?? []

  return (
    <>
      <div className="search-input mb-md" style={{ width: '100%' }}>
        <Icon name="search" />
        <input
          placeholder="Buscar por e-NCF (ej. E310000000321)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar factura por e-NCF"
          autoFocus
        />
        {lista.fetching && !lista.loading && <Icon name="loader" className="spin" />}
      </div>

      {lista.loading ? (
        <div className="row" style={{ justifyContent: 'center', padding: 28 }}><Spinner /></div>
      ) : lista.error ? (
        <div className="state" style={{ padding: 28 }}><span className="text-sm" style={{ color: 'var(--danger)' }}>{lista.error}</span></div>
      ) : filas.length === 0 ? (
        <div className="state" style={{ padding: 28 }}>
          <span className="text-sm muted">
            {qDebounced
              ? `Ninguna factura aceptada de este cliente coincide con «${qDebounced}».`
              : 'Este cliente no tiene facturas aceptadas por la DGII. Una nota solo puede modificar una factura aceptada.'}
          </span>
        </div>
      ) : (
        <div className="col" style={{ maxHeight: 360, overflowY: 'auto', margin: '0 -8px' }}>
          {filas.map((f) => {
            // Una nota de crédito no puede pasar del saldo: sin saldo, no se elige.
            const agotada = esCredito && f.saldo <= 0
            return (
              <button
                type="button"
                key={f.id}
                className="menu-item fx-nota-ref-op"
                disabled={agotada}
                aria-current={f.e_ncf === elegida || undefined}
                onClick={() => onElegir(f)}
              >
                <span className="fx-nota-ref-op-main">
                  <span className="mono fw6 text-sm">{f.e_ncf}</span>
                  <span className="text-xs muted">{nombreTipo(f.tipo_ecf)} · {formatApiDate(f.fecha_emision)}</span>
                </span>
                <span className="fx-nota-ref-op-montos">
                  <span className="fw6 text-sm"><Money value={f.total} cur={false} /></span>
                  {esCredito && (f.notas_credito > 0 || f.notas_debito > 0) && (
                    <span className="text-xs muted">
                      {agotada ? 'Acreditada por completo' : <>Queda <Money value={f.saldo} cur={false} /></>}
                    </span>
                  )}
                </span>
                {f.e_ncf === elegida && <Icon name="check" size={15} />}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
