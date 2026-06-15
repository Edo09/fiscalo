// Botón "Actualizar" con feedback: gira el icono mientras recarga y avisa al
// terminar. onRefresh puede devolver void o una promesa (p.ej. Promise.all de
// varios reload()); se espera para mantener el spinner hasta que lleguen datos.
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Btn } from './Btn'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface RefreshButtonProps {
  onRefresh: () => unknown
  children?: ReactNode
}

export function RefreshButton({ onRefresh, children = 'Actualizar' }: RefreshButtonProps) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      // Mínimo 500 ms para que el giro sea perceptible aunque la red responda al instante.
      await Promise.all([Promise.resolve(onRefresh()), delay(500)])
      toast.success('Datos actualizados.')
    } catch {
      toast.error('No se pudieron actualizar los datos.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Btn
      variant="secondary"
      icon="refresh-cw"
      className={busy ? 'is-refreshing' : ''}
      onClick={run}
      disabled={busy}
    >
      {children}
    </Btn>
  )
}
