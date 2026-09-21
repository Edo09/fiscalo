// Detalle de un registro de la bitácora: qué pasó, quién, desde dónde, y los
// cambios campo por campo (antes -> después).
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge, Btn, Drawer } from '@/components/ui'
import type { AuditLogRow } from '@/api'
import type { Nav } from '@/config/navigation'
import { etiquetaAccion, etiquetaCampo, etiquetaModulo, fechaHora, quien, tonoAccion } from './etiquetas'
import { esRegistro, filasCambio, REDACTADO } from './cambios'
import { destinoEntidad } from './entidad'

function Valor({ v }: { v: unknown }) {
  if (v === undefined || v === null || v === '') return <span className="muted-3">—</span>
  if (v === REDACTADO) return <i className="muted">Oculto por seguridad</i>
  if (typeof v === 'boolean') return <>{v ? 'Sí' : 'No'}</>
  if (typeof v === 'object') {
    return (
      <pre className="mono text-xs" style={{ margin: 0, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {JSON.stringify(v, null, 2)}
      </pre>
    )
  }
  return <span style={{ wordBreak: 'break-word' }}>{String(v)}</span>
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, padding: '5px 0' }}>
      <span className="text-sm muted">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="fw6 text-sm mb-sm">{titulo}</div>
      {children}
    </div>
  )
}

function Cambios({ row }: { row: AuditLogRow }) {
  const [verTodos, setVerTodos] = useState(false)
  const antes = row.old_values
  const despues = row.new_values
  const filas = filasCambio(antes, despues)

  // Detalle que no es un objeto (texto suelto): se muestra tal cual.
  if (filas.length === 0) {
    if (antes == null && despues == null) return null
    return (
      <Seccion titulo="Detalle">
        <Valor v={despues ?? antes} />
      </Seccion>
    )
  }

  const modificacion = esRegistro(antes) && esRegistro(despues)
  const sinCambio = filas.filter((f) => !f.cambio).length
  const visibles = modificacion && !verTodos ? filas.filter((f) => f.cambio) : filas
  const titulo = modificacion
    ? 'Cambios'
    : esRegistro(despues) ? (row.action === 'CREATE' ? 'Datos registrados' : 'Detalle del evento') : 'Datos antes de eliminar'

  return (
    <Seccion titulo={titulo}>
      <div className="tbl-wrap" style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: '28%' }}>Campo</th>
              {modificacion ? <><th>Antes</th><th>Después</th></> : <th>Valor</th>}
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => (
              <tr key={f.campo} style={{ cursor: 'default' }}>
                <td className="text-sm fw5">{etiquetaCampo(f.campo)}</td>
                {modificacion ? (
                  <>
                    <td className="text-sm" style={f.cambio ? { background: 'var(--danger-soft)' } : undefined}><Valor v={f.antes} /></td>
                    <td className="text-sm" style={f.cambio ? { background: 'var(--success-soft)' } : undefined}><Valor v={f.despues} /></td>
                  </>
                ) : (
                  <td className="text-sm"><Valor v={esRegistro(despues) ? f.despues : f.antes} /></td>
                )}
              </tr>
            ))}
            {modificacion && visibles.length === 0 && (
              <tr style={{ cursor: 'default' }}>
                <td colSpan={3} className="text-sm muted" style={{ textAlign: 'center' }}>Se guardó sin cambiar ningún campo.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {modificacion && sinCambio > 0 && (
        <button type="button" className="filter-chip" style={{ marginTop: 8 }} onClick={() => setVerTodos((v) => !v)}>
          {verTodos ? 'Ocultar campos sin cambios' : `Mostrar ${sinCambio} campos sin cambios`}
        </button>
      )}
    </Seccion>
  )
}

export function AuditDetailDrawer({ row, onClose, nav }: { row: AuditLogRow; onClose: () => void; nav: Nav }) {
  const [abriendo, setAbriendo] = useState(false)
  const destino = destinoEntidad(row)

  const abrir = async () => {
    if (!destino) return
    setAbriendo(true)
    try {
      await destino.abrir(nav)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo abrir el documento.')
    } finally {
      setAbriendo(false)
    }
  }

  const origen = [row.browser, row.os, row.device_type].filter(Boolean).join(' · ')

  return (
    <Drawer
      title={etiquetaAccion(row.action)}
      sub={`${fechaHora(row.created_at)} · ${etiquetaModulo(row.module)}`}
      onClose={onClose}
      width={640}
      footer={destino ? (
        <Btn variant="primary" icon="arrow-up-right" onClick={() => void abrir()} disabled={abriendo}>
          {abriendo ? 'Abriendo…' : destino.etiqueta}
        </Btn>
      ) : undefined}
    >
      <Seccion titulo="Qué pasó">
        <Dato label="Resultado">
          <Badge tone={tonoAccion(row)} dot>{row.success ? 'Exitoso' : 'Fallido'}</Badge>
        </Dato>
        {row.description && <Dato label="Descripción">{row.description}</Dato>}
        {row.error_message && (
          <Dato label="Motivo"><span style={{ color: 'var(--danger)' }}>{row.error_message}</span></Dato>
        )}
        {row.entity_type && (
          <Dato label="Documento">
            {etiquetaCampo(row.entity_type)}{row.entity_id ? <span className="mono"> · {row.entity_id}</span> : null}
          </Dato>
        )}
      </Seccion>

      <Seccion titulo="Quién">
        <Dato label="Usuario">{quien(row)}</Dato>
        {row.email && row.email !== row.username && <Dato label="Correo">{row.email}</Dato>}
      </Seccion>

      <Seccion titulo="Desde dónde">
        <Dato label="IP"><span className="mono">{row.ip_address ?? '—'}</span></Dato>
        {origen && <Dato label="Equipo">{origen}</Dato>}
        {row.endpoint && (
          <Dato label="Petición"><span className="mono text-xs">{row.http_method} {row.endpoint}</span></Dato>
        )}
      </Seccion>

      <Cambios row={row} />
    </Drawer>
  )
}
