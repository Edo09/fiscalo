// Marcar que una empresa de un GRUPO no paga la mensualidad del grupo (solo certificó): el grupo sigue siendo uno y se cobra una vez, pero
// esta empresa deja de contar como la que paga y la fila se nombra por una que sí paga. Pide un motivo (opcional) y NO borra nada: se
// devuelve cuando se quiera con "Sí paga". Si no está en un grupo de dos o más, o es la última que paga, la API lo rechaza (409) y el
// texto de su error, que dice qué hacer, se muestra aquí.
import { useState } from 'react'
import { toast } from 'sonner'
import { Btn, Modal } from '@/components/ui'
import { ApiError } from '@/api'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { usePagaTenant } from '../hooks'
import { Aviso } from './Aviso'

const MAX_MOTIVO = 150

export function SinPagoModal({ clientId, nombre, onClose }: { clientId: number; nombre: string; onClose: () => void }) {
  const marcar = usePagaTenant()
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const confirmar = useAccionUnica(async () => {
    setError(null)
    if (motivo.trim().length > MAX_MOTIVO) { setError(`El motivo no puede pasar de ${MAX_MOTIVO} caracteres.`); return }
    setSaving(true)
    try {
      await marcar.mutateAsync({ clientId, paga: false, motivo: motivo.trim() || undefined })
      toast.success(`${nombre} quedó como "solo certificó": no paga la mensualidad del grupo.`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo marcar que la empresa no paga la mensualidad.')
    } finally {
      setSaving(false)
    }
  })

  return (
    <Modal
      title="Marcar que no paga la mensualidad" sub={nombre} icon="user-x" onClose={onClose} bloqueado={saving}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Btn>
          <Btn variant="primary" icon="user-x" onClick={() => void confirmar()} disabled={saving}>{saving ? 'Marcando…' : 'Marcar que no paga'}</Btn>
        </>
      }
    >
      <Aviso>
        No se borra nada: la empresa sigue en su grupo, con sus e-CF y su historial intactos. Solo deja de contar como una de las que pagan, y
        el grupo se nombra por una que sí paga. La puedes volver a marcar como que paga cuando quieras.
      </Aviso>
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="field">
        <label className="label" htmlFor="motivo-sin-pago">Motivo <span className="opt">(opcional)</span></label>
        <textarea
          id="motivo-sin-pago" className="textarea" rows={3} value={motivo} maxLength={MAX_MOTIVO} autoFocus
          placeholder="Por ejemplo: solo certificó" onChange={(e) => setMotivo(e.target.value)}
        />
      </div>
    </Modal>
  )
}
