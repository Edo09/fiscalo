// FISCALO — Modales de "Punto de venta": empleado, PIN (se ve una sola vez),
// caja y revocar equipo. Todo contra /api/pos-admin (src/api/pos.ts); al
// guardar se invalida ['pos'] para que las pestañas se refresquen.
import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal, Btn, Switch, Seg, Icon } from '@/components/ui'
import { ApiError } from '@/api'
import {
  crearPosEmpleado, actualizarPosEmpleado, regenerarPosPin,
  crearPosCaja, actualizarPosCaja, revocarPosEquipo,
} from '@/api/pos'
import type { PosCaja, PosEmpleado, PosEquipo, PosRol } from '@/api/pos'
import { ROL_LABEL, ROL_AYUDA, fmtFecha } from './textos'

function invalidarPos(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['pos'] })
}

function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className="row gap-sm" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', padding: '9px 12px', borderRadius: 'var(--r-sm)', marginBottom: 14, fontSize: 12.5, fontWeight: 500 }}>
      <Icon name="alert-circle" size={16} /><span>{error}</span>
    </div>
  )
}

function Nota({ icon = 'info', children }: { icon?: 'info' | 'alert-triangle'; children: ReactNode }) {
  return (
    <div className="row gap-sm" style={{ color: 'var(--text-2)', fontSize: 12.5, alignItems: 'flex-start' }}>
      <Icon name={icon} size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span>{children}</span>
    </div>
  )
}

const mensaje = (e: unknown, porDefecto: string) => (e instanceof ApiError ? e.message : porDefecto)

// --- Empleado --------------------------------------------------------------

interface EmpleadoModalProps {
  /** null => crear. */
  empleado: PosEmpleado | null
  onClose: () => void
  /** El API devolvió un PIN (alta o PIN nuevo): hay que mostrarlo, una sola vez. */
  onPin: (empleado: PosEmpleado, pin: string, nuevo: boolean) => void
}

export function EmpleadoModal({ empleado, onClose, onPin }: EmpleadoModalProps) {
  const qc = useQueryClient()
  const editando = empleado !== null
  const [nombre, setNombre] = useState(empleado?.nombre ?? '')
  const [rol, setRol] = useState<PosRol>(empleado?.rol ?? 'cajero')
  const [activo, setActivo] = useState(empleado?.activo ?? true)
  const [guardando, setGuardando] = useState(false)
  const [confirmPin, setConfirmPin] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cambios = empleado
    ? { nombre: nombre.trim() !== empleado.nombre, rol: rol !== empleado.rol, activo: activo !== empleado.activo }
    : null
  const hayCambios = cambios !== null && (cambios.nombre || cambios.rol || cambios.activo)

  const guardar = async () => {
    if (!nombre.trim()) { setError('Escribe el nombre del empleado.'); return }
    setError(null)
    setGuardando(true)
    try {
      if (empleado && cambios) {
        if (hayCambios) {
          await actualizarPosEmpleado(empleado.id, {
            ...(cambios.nombre ? { nombre: nombre.trim() } : {}),
            ...(cambios.rol ? { rol } : {}),
            ...(cambios.activo ? { activo } : {}),
          })
          invalidarPos(qc)
          toast.success(`Empleado "${nombre.trim()}" actualizado.`)
        }
        onClose()
      } else {
        const r = await crearPosEmpleado(nombre.trim(), rol)
        invalidarPos(qc)
        onPin(r.empleado, r.pin, true)
      }
    } catch (e) {
      setError(mensaje(e, 'No se pudo guardar el empleado.'))
      setGuardando(false)
    }
  }

  const generarPin = async () => {
    if (!empleado) return
    setError(null)
    setGenerando(true)
    try {
      const r = await regenerarPosPin(empleado.id)
      invalidarPos(qc)
      onPin(r.empleado, r.pin, false)
    } catch (e) {
      setError(mensaje(e, 'No se pudo generar el PIN nuevo.'))
      setGenerando(false)
      setConfirmPin(false)
    }
  }

  return (
    <Modal
      title={editando ? 'Editar empleado' : 'Nuevo empleado'}
      sub={editando ? empleado?.nombre : 'El sistema le genera un PIN de 4 dígitos para entrar al POS'}
      icon="user"
      width={540}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" icon={editando ? 'save' : 'user-plus'} onClick={guardar} disabled={guardando || generando}>
            {guardando ? 'Guardando…' : editando ? 'Guardar' : 'Crear y ver PIN'}
          </Btn>
        </>
      }
    >
      <ErrorBanner error={error} />

      <div className="form-grid">
        <div className="field full">
          <label className="label">Nombre <span className="req">*</span></label>
          <input className="input" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej. María Pérez" autoFocus={!editando} />
        </div>
        <div className="field full">
          <label className="label">Rol</label>
          <div><Seg options={['Cajero', 'Supervisor']} value={ROL_LABEL[rol]}
            onChange={(v) => setRol(v === 'Supervisor' ? 'supervisor' : 'cajero')} /></div>
          <span className="text-sm muted" style={{ marginTop: 6 }}>{ROL_AYUDA[rol]}</span>
        </div>
        {editando && (
          <div className="field full">
            <span className="row gap-sm" style={{ alignItems: 'center', cursor: 'pointer' }} onClick={() => setActivo(!activo)}>
              <Switch on={activo} />
              <span className="text-sm">Activo</span>
            </span>
            {!activo && empleado?.activo && (
              <span className="text-sm muted" style={{ marginTop: 6 }}>
                Al guardar ya no podrá entrar al POS y, si está dentro, se le cierra la sesión.
              </span>
            )}
          </div>
        )}
      </div>

      {editando && empleado && (
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 18, paddingTop: 14 }}>
          <div className="row between" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div className="text-sm" style={{ fontWeight: 600 }}>PIN</div>
              <div className="text-sm muted">Generado el {fmtFecha(empleado.pin_generado_at)}. No se puede consultar, solo reemplazar.</div>
            </div>
            {confirmPin ? (
              <span className="row gap-sm" style={{ alignItems: 'center' }}>
                <span className="text-sm muted">¿Generar otro?</span>
                <Btn variant="ghost" size="sm" onClick={() => setConfirmPin(false)} disabled={generando}>No</Btn>
                <Btn variant="primary" size="sm" icon="key" onClick={generarPin} disabled={generando}>
                  {generando ? 'Generando…' : 'Sí, generar'}
                </Btn>
              </span>
            ) : (
              <Btn variant="secondary" size="sm" icon="key" onClick={() => setConfirmPin(true)} disabled={hayCambios || guardando}>
                Generar PIN nuevo
              </Btn>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <Nota>
              {hayCambios
                ? 'Guarda o descarta los cambios antes de generar un PIN nuevo.'
                : 'Úsalo si lo olvidó o si alguien más lo sabe: el PIN actual deja de servir en el acto y, si está dentro del POS, se le cierra la sesión.'}
            </Nota>
          </div>
        </div>
      )}
    </Modal>
  )
}

// --- PIN (una sola vez) ------------------------------------------------------

interface PinModalProps {
  empleado: PosEmpleado
  pin: string
  /** true = empleado recién creado; false = PIN nuevo de uno existente. */
  nuevo: boolean
  onClose: () => void
}

export function PinModal({ empleado, pin, nuevo, onClose }: PinModalProps) {
  return (
    <Modal
      title={nuevo ? 'Empleado creado' : 'PIN nuevo generado'}
      sub={`${empleado.nombre} · ${ROL_LABEL[empleado.rol]}`}
      icon="key"
      width={460}
      onClose={onClose}
      footer={<Btn variant="primary" icon="check" onClick={onClose}>Ya lo anoté</Btn>}
    >
      <div className="text-sm muted" style={{ textAlign: 'center' }}>PIN para entrar al POS</div>
      <div aria-label={`PIN ${pin.split('').join(' ')}`}
        style={{ display: 'flex', justifyContent: 'center', gap: 10, margin: '12px 0 18px' }}>
        {pin.split('').map((d, i) => (
          <span key={i} style={{
            width: 54, height: 64, display: 'grid', placeItems: 'center', borderRadius: 'var(--r-md)',
            border: '1px solid var(--border)', background: 'var(--surface-2)',
            fontSize: 34, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
          }}>{d}</span>
        ))}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        <Nota icon="alert-triangle">
          <b>Es la única vez que se muestra.</b> Anótalo y entrégaselo a {empleado.nombre} en persona.
          Si se pierde, genera uno nuevo desde su ficha.
        </Nota>
        <Nota>Con este PIN entra en cualquier caja de la empresa. Es personal: nadie más debe usarlo.</Nota>
      </div>
    </Modal>
  )
}

// --- Caja -------------------------------------------------------------------

interface CajaModalProps {
  /** null => crear. */
  caja: PosCaja | null
  /** Equipo que tiene la caja ahora (solo para avisar al desactivarla). */
  equipo: PosEquipo | null
  onClose: () => void
}

export function CajaModal({ caja, equipo, onClose }: CajaModalProps) {
  const qc = useQueryClient()
  const editando = caja !== null
  const [nombre, setNombre] = useState(caja?.nombre ?? '')
  const [activa, setActiva] = useState(caja?.activa ?? true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const guardar = async () => {
    if (!nombre.trim()) { setError('Escribe el nombre de la caja.'); return }
    setError(null)
    setGuardando(true)
    try {
      if (caja) {
        const campos = {
          ...(nombre.trim() !== caja.nombre ? { nombre: nombre.trim() } : {}),
          ...(activa !== caja.activa ? { activa } : {}),
        }
        if (Object.keys(campos).length > 0) {
          await actualizarPosCaja(caja.id, campos)
          invalidarPos(qc)
          toast.success(`Caja "${nombre.trim()}" actualizada.`)
        }
      } else {
        await crearPosCaja(nombre.trim())
        invalidarPos(qc)
        toast.success(`Caja "${nombre.trim()}" creada. Ahora habilita la PC de esa caja desde el POS.`)
      }
      onClose()
    } catch (e) {
      setError(mensaje(e, 'No se pudo guardar la caja.'))
      setGuardando(false)
    }
  }

  return (
    <Modal
      title={editando ? 'Editar caja' : 'Nueva caja'}
      sub={editando ? caja?.nombre : 'Cada caja se usa desde un solo equipo (PC)'}
      icon="monitor"
      width={500}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" icon="save" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Btn>
        </>
      }
    >
      <ErrorBanner error={error} />
      <div className="form-grid">
        <div className="field full">
          <label className="label">Nombre <span className="req">*</span></label>
          <input className="input" value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej. Caja 1" autoFocus={!editando} />
        </div>
        {editando && (
          <div className="field full">
            <span className="row gap-sm" style={{ alignItems: 'center', cursor: 'pointer' }} onClick={() => setActiva(!activa)}>
              <Switch on={activa} />
              <span className="text-sm">Activa</span>
            </span>
            {!activa && caja?.activa && (
              <span className="text-sm muted" style={{ marginTop: 6 }}>
                {equipo
                  ? `Su equipo (${equipo.nombre || 'sin nombre'}) sigue habilitado, pero nadie podrá entrar con su PIN hasta que la actives de nuevo.`
                  : 'No se podrá habilitar ningún equipo en ella hasta que la actives de nuevo.'}
              </span>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

// --- Revocar equipo ----------------------------------------------------------

export function RevocarEquipoModal({ equipo, onClose }: { equipo: PosEquipo; onClose: () => void }) {
  const qc = useQueryClient()
  const [revocando, setRevocando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const caja = equipo.caja?.nombre ?? `#${equipo.caja_id}`

  const revocar = async () => {
    setError(null)
    setRevocando(true)
    try {
      await revocarPosEquipo(equipo.id)
      invalidarPos(qc)
      toast.success(`Equipo de la caja "${caja}" revocado.`)
      onClose()
    } catch (e) {
      setError(mensaje(e, 'No se pudo revocar el equipo.'))
      setRevocando(false)
    }
  }

  return (
    <Modal
      title="Revocar equipo"
      sub={`${equipo.nombre || 'Equipo sin nombre'} · ${caja}`}
      icon="monitor"
      width={480}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn variant="danger" icon="ban" onClick={revocar} disabled={revocando}>{revocando ? 'Revocando…' : 'Revocar equipo'}</Btn>
        </>
      }
    >
      <ErrorBanner error={error} />
      <div style={{ display: 'grid', gap: 10 }}>
        <Nota icon="alert-triangle">
          Esa PC deja de funcionar como caja en el acto y, si hay un empleado dentro, se le cierra la sesión.
        </Nota>
        <Nota>
          Para volver a usarla hay que habilitarla de nuevo desde el POS. Sirve también para quitar un bloqueo
          por PINs incorrectos sin esperar.
        </Nota>
      </div>
    </Modal>
  )
}
