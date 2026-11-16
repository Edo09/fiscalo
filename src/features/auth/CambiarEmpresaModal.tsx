// Selector de empresa de un usuario de soporte (acceso global; api-gratex
// docs/modules/acceso-global.md): las empresas a las que puede pasar su sesión,
// con búsqueda por nombre o RNC. Elegir una la manda a `onElegir`: quien abre el
// selector pregunta por lo que haya sin guardar y hace el cambio (Navbar).
import { useMemo, useState } from 'react'
import { Badge, EmptyState, ErrorState, Icon, LoadingState, Modal } from '@/components/ui'
import { useApiQuery } from '@/hooks/useApiQuery'
import { empresasAccesoGlobal, type EmpresaAcceso } from '@/api/auth'
import { etiquetaAmbiente, filtrarEmpresas, iniciales } from './accesoGlobal'

export interface CambiarEmpresaModalProps {
  onClose: () => void
  onElegir: (empresa: EmpresaAcceso) => void
}

export function CambiarEmpresaModal({ onClose, onElegir }: CambiarEmpresaModalProps) {
  // Siempre fresca: una empresa nueva o desactivada tiene que verse al abrir.
  const q = useApiQuery(['auth-empresas'], empresasAccesoGlobal, { staleTime: 0 })
  const [texto, setTexto] = useState('')
  const empresas = useMemo(() => filtrarEmpresas(q.data?.empresas ?? [], texto), [q.data, texto])
  const actual = q.data?.actual ?? null

  // La empresa en la que ya está no se vuelve a elegir: solo cierra.
  const elegir = (e: EmpresaAcceso) => (e.id === actual ? onClose() : onElegir(e))

  let cuerpo
  if (q.loading) {
    cuerpo = <LoadingState rows={4} />
  } else if (q.error) {
    cuerpo = <ErrorState title="No se pudo cargar la lista de empresas" onRetry={() => void q.reload()}>{q.error}</ErrorState>
  } else if (empresas.length === 0) {
    cuerpo = (
      <EmptyState icon="search" title="Ninguna empresa coincide">
        Prueba con otra parte del nombre o con el RNC.
      </EmptyState>
    )
  } else {
    cuerpo = (
      <div className="empresa-lista">
        {empresas.map((e) => {
          const esActual = e.id === actual
          const ambiente = etiquetaAmbiente(e.ambiente)
          return (
            <button
              key={e.id}
              type="button"
              className={'empresa-fila' + (esActual ? ' actual' : '')}
              aria-current={esActual ? 'true' : undefined}
              onClick={() => elegir(e)}
            >
              <span className="co-logo">{iniciales(e.nombre)}</span>
              <span className="empresa-fila-txt">
                <span className="nm">{e.nombre}</span>
                <span className="sub mono">RNC {e.rnc}</span>
              </span>
              <span className="empresa-fila-badges">
                {ambiente && <Badge tone="warning">{ambiente}</Badge>}
                {e.propia && <Badge>Tu empresa</Badge>}
                {esActual && <Badge tone="accent" dot>Actual</Badge>}
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <Modal
      title="Cambiar de empresa"
      sub="Entras con tu usuario como soporte. Lo que hagas queda en la bitácora de esa empresa."
      icon="arrow-left-right"
      onClose={onClose}
      width={540}
    >
      <div className="search-input mb-md">
        <Icon name="search" />
        <input
          autoFocus
          value={texto}
          onChange={(ev) => setTexto(ev.target.value)}
          // Enter con un solo resultado entra a esa empresa: buscar y entrar sin el ratón.
          onKeyDown={(ev) => { if (ev.key === 'Enter' && empresas.length === 1) elegir(empresas[0]) }}
          placeholder="Buscar por nombre o RNC"
          aria-label="Buscar empresa por nombre o RNC"
        />
      </div>
      {cuerpo}
    </Modal>
  )
}
