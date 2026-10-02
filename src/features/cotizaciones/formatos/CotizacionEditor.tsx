import { useRef, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Btn, Card, EmptyState, ErrorState, LoadingState, PageHead } from '@/components/ui'
import { getCotizacion } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Nav } from '@/config/navigation'
import { FORMATOS, formatoDeFila, useCotizacionFormato, type FormatoId } from './index'

/* FISCALO — Editor de cotizaciones: elige el formulario del formato.

   Una cotización nueva se arma con el formato del tenant; una guardada, con el
   suyo (su columna `formato`), aunque el tenant haya cambiado después. Hasta
   saberlo se muestra un estado de carga: montar un formulario y cambiarlo por
   otro al llegar el dato perdería lo que el usuario ya escribió. Por lo mismo,
   una vez elegido, el formulario se queda aunque un refresco posterior falle o
   traiga otra cosa (si el formato del tenant cambió, el backend responde 409
   al guardar y el formulario pide recargar). */
export function CotizacionEditor({ nav, cotizacionId }: { nav: Nav; cotizacionId: number | null }) {
  return cotizacionId == null
    ? <EditorNueva nav={nav} />
    : <EditorExistente nav={nav} cotizacionId={cotizacionId} />
}

/** Marco de los estados previos al formulario (cargando, error, no existe). */
function Marco({ nav, children }: { nav: Nav; children: ReactNode }) {
  return (
    <div className="page">
      <PageHead title="Cotización" crumbs={[{ label: 'Cotizaciones', onClick: () => nav('cotizaciones') }]} />
      <Card>{children}</Card>
    </div>
  )
}

function EditorNueva({ nav }: { nav: Nav }) {
  const queryClient = useQueryClient()
  const { formato, cargando, error } = useCotizacionFormato()
  // Primera decisión, y la única (ver arriba).
  const elegido = useRef<FormatoId | null>(null)
  if (elegido.current == null && !cargando && error == null) elegido.current = formato

  if (elegido.current != null) {
    const { Form } = FORMATOS[elegido.current]
    return <Form nav={nav} cotizacionId={null} />
  }
  if (cargando) return <Marco nav={nav}><LoadingState rows={6} /></Marco>
  return (
    <Marco nav={nav}>
      <ErrorState
        title="No se pudo preparar la cotización"
        onRetry={() => void queryClient.refetchQueries({ queryKey: ['branding'] })}
      >
        {error}
      </ErrorState>
    </Marco>
  )
}

function EditorExistente({ nav, cotizacionId }: { nav: Nav; cotizacionId: number }) {
  // Misma clave y el mismo dato crudo (CotizacionRow | null) que
  // CotizacionFormView: el formulario de Gratex encuentra la fila en la caché y
  // no la vuelve a pedir. Por eso aquí no se transforma nada en el queryFn.
  const detalle = useApiQuery(['cotizaciones', 'detail', cotizacionId], () => getCotizacion(cotizacionId))
  const elegido = useRef<FormatoId | null>(null)
  if (elegido.current == null && detalle.data != null) elegido.current = formatoDeFila(detalle.data)

  if (elegido.current != null) {
    const { Form } = FORMATOS[elegido.current]
    return <Form nav={nav} cotizacionId={cotizacionId} />
  }
  if (detalle.loading) return <Marco nav={nav}><LoadingState rows={6} /></Marco>
  if (detalle.error != null) {
    return (
      <Marco nav={nav}>
        <ErrorState title="No se pudo cargar la cotización" onRetry={() => void detalle.reload()}>
          {detalle.error}
        </ErrorState>
      </Marco>
    )
  }
  // El backend respondió sin fila: la borraron (otro usuario, otra pestaña) o
  // el enlace es viejo. Antes se abría una hoja en blanco que parecía lista
  // para guardar.
  return (
    <Marco nav={nav}>
      <EmptyState
        icon="file-plus"
        title="Esta cotización ya no existe"
        action={
          <Btn variant="secondary" icon="arrow-left" onClick={() => nav('cotizaciones', null, { replace: true })}>
            Ir a cotizaciones
          </Btn>
        }
      >
        Puede que alguien la haya eliminado.
      </EmptyState>
    </Marco>
  )
}
