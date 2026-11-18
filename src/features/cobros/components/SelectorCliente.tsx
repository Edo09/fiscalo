// El buscador con que se elige "el cliente" de un cobro: el de Clientes de siempre en una empresa (ClientCombobox) y el de
// tenants en la plataforma (TenantCombobox). Avisa con el id y el nombre del elegido, igual en los dos.
import { ClientCombobox } from '@/features/clients/ClientCombobox'
import { useAmbitoCobros } from '../ambito'
import { TenantCombobox } from './TenantCombobox'

export function SelectorCliente({ onElegir, invalido = false }: {
  onElegir: (id: number, nombre: string) => void
  invalido?: boolean
}) {
  const { id } = useAmbitoCobros()
  if (id === 'tenants') return <TenantCombobox onElegir={onElegir} invalido={invalido} />
  return (
    <ClientCombobox
      value={null}
      onChange={(c) => { if (c) onElegir(Number(c.id), c.nombre) }}
      invalido={invalido}
    />
  )
}
