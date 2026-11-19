// Quitar a una empresa de la lista de clientes de Cobros de tenants ("no es un cliente"): es de prueba, es interna… Pide un
// motivo (opcional) y NO borra nada: la empresa sale de la lista y de los buscadores, y se devuelve cuando se quiera con
// "Mostrar las que no se cobran". Si es la cabeza de un grupo, sale todo el grupo (el aviso lo dice). Con cobros abiertos o su
// cobro mensual activo la API lo rechaza (409) y el texto de su error, que dice qué hacer, se muestra aquí.
import { useState } from 'react'
import { toast } from 'sonner'
import { Btn, Modal } from '@/components/ui'
import { ApiError } from '@/api'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { textoQuitarGrupo } from '../format'
import { useExcluirTenant } from '../hooks'
import { Aviso } from './Aviso'

const MAX_MOTIVO = 150

/** `empresas` son las del grupo de la unidad (ella incluida); 1 si no tiene grupo. */
export function QuitarClienteModal({ clientId, nombre, empresas = 1, onClose }: { clientId: number; nombre: string; empresas?: number; onClose: () => void }) {
  const excluir = useExcluirTenant()
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const confirmar = useAccionUnica(async () => {
    setError(null)
    if (motivo.trim().length > MAX_MOTIVO) { setError(`El motivo no puede pasar de ${MAX_MOTIVO} caracteres.`); return }
    setSaving(true)
    try {
      await excluir.mutateAsync({ clientId, excluido: true, motivo: motivo.trim() || undefined })
      toast.success(`${nombre} salió de la lista de clientes. Para devolverla: "Mostrar las que no se cobran".`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo quitar a la empresa de la lista de clientes.')
    } finally {
      setSaving(false)
    }
  })

  return (
    <Modal
      title="Quitar de la lista de clientes" sub={nombre} icon="user-x" onClose={onClose} bloqueado={saving}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>No quitarla</Btn>
          <Btn variant="primary" icon="user-x" onClick={() => void confirmar()} disabled={saving}>{saving ? 'Quitando…' : 'Quitar de la lista'}</Btn>
        </>
      }
    >
      <Aviso>
        No se borra nada: la empresa sale de la lista de clientes y de los buscadores, con sus e-CF y su historial intactos, y la puedes
        devolver cuando quieras. Si tiene cobros abiertos o su cobro mensual activo, primero hay que cobrarlos o desactivarlo.
      </Aviso>
      {textoQuitarGrupo(empresas) && <Aviso>{textoQuitarGrupo(empresas)}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="field">
        <label className="label" htmlFor="motivo-exclusion">Motivo <span className="opt">(opcional)</span></label>
        <textarea
          id="motivo-exclusion" className="textarea" rows={3} value={motivo} maxLength={MAX_MOTIVO} autoFocus
          placeholder="Por ejemplo: la creé solo para certificarla" onChange={(e) => setMotivo(e.target.value)}
        />
      </div>
    </Modal>
  )
}
