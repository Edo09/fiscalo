import { useRef, useState, type ReactNode } from 'react'
import { Btn, Card, EmptyState, ErrorState, LoadingState, PageHead } from '@/components/ui'
import { getClient, getConduce, getCotizacion, mapClientRow } from '@/api'
import type { ClientRow, ConduceRow, CotizacionRow } from '@/api'
import { useApiQuery, type ApiQueryState } from '@/hooks/useApiQuery'
import { isConduceDesdeCotizacion, isConduceRef, type Nav, type PayloadConduce } from '@/config/navigation'
import { formatoDeFila } from '@/features/cotizaciones/formatos'
import { useFormatoTenant } from '@/features/cotizaciones/formatos/useFormatoTenant'
import { clienteDeFila, lineasDeFila } from '@/features/cotizaciones/formatos/ferreteria/lineas'
import { hoyLocal } from '@/lib/date'
import {
  MSG_CONDUCE_NO_EXISTE, MSG_COTIZACION_NO_EXISTE, MSG_SOLO_FERRETERIA, avisoCargosConduce,
} from './schema'
import { ConduceForm, type InicialConduce } from './ConduceForm'

/* FISCALO — Editor de conduces: carga el documento y abre el formulario.

   Tres entradas (spec conduces 5.5; la tercera, decisión del 2026-10-08):
   - desde una cotización (botón "Conduce" de Cotizaciones): un conduce nuevo
     con el cliente y las líneas de esa cotización, fechado hoy;
   - un conduce guardado (clic en su fila de Conduces);
   - uno nuevo en blanco, sin cotización (botón "Nuevo conduce" de Conduces,
     payload { kind: 'nuevo' }): sin cliente ni líneas, fechado hoy.

   El formulario se monta UNA vez, con todo resuelto: el documento y también
   el cliente (si se borró, abre sin cliente y lo dice). Montarlo antes y
   cambiarle los datos al llegar perdería lo que el usuario ya escribió. Por lo
   mismo se espera el dato fresco: si la caché tenía una versión vieja de la
   cotización (se acaba de editar), las líneas salen de la nueva.

   Nada de esto llama a /api/conduces ni a la cotización hasta saber que la
   empresa es de Ferretería: a cualquier otra el backend le responde 422, y App
   saca de esta vista al saber que el formato es otro. */
export function ConduceEditor({ nav, payload }: { nav: Nav; payload: PayloadConduce }) {
  const { formato, error, reintentar } = useFormatoTenant()
  // Primera decisión, y la única: un refresco de branding no desmonta el formulario.
  const habilitado = useRef(false)
  if (formato === 'ferreteria') habilitado.current = true

  if (habilitado.current) {
    if (isConduceRef(payload)) return <EditorExistente nav={nav} conduceId={payload.id} />
    if (isConduceDesdeCotizacion(payload)) return <EditorDesdeCotizacion nav={nav} cotizacionId={payload.cotizacionId} />
    return <EditorEnBlanco nav={nav} />
  }
  // Solo el que sale de una cotización vuelve a Cotizaciones; los demás, a Conduces.
  const desde = isConduceDesdeCotizacion(payload) ? 'cotizaciones' : 'conduces'
  return (
    <Marco nav={nav} desde={desde}>
      {error ? (
        <ErrorState title="No se pudo preparar el conduce" onRetry={reintentar}>
          No se pudo saber si tu empresa trabaja con conduces. Revisa la conexión e inténtalo de nuevo.
        </ErrorState>
      ) : (
        <LoadingState rows={6} />
      )}
    </Marco>
  )
}

/** Marco de los estados previos al formulario (cargando, error, no existe). */
function Marco({ nav, desde, children }: { nav: Nav; desde: 'conduces' | 'cotizaciones'; children: ReactNode }) {
  return (
    <div className="page">
      <PageHead
        title="Conduce"
        crumbs={[{ label: desde === 'conduces' ? 'Conduces' : 'Cotizaciones', onClick: () => nav(desde) }]}
      />
      <Card>{children}</Card>
    </div>
  )
}

/** Lo que dice el documento de origen; el cliente se resuelve aparte (ConClienteResuelto). */
interface DocumentoConduce {
  datos: Omit<InicialConduce, 'cliente' | 'clienteCompleto' | 'clienteBorrado'>
  clientId: number | null
  /** Nombre para la ficha provisional: el del cliente, o el guardado en el conduce. */
  clienteNombre: string
}

function desdeCotizacion(row: CotizacionRow): DocumentoConduce {
  return {
    datos: {
      conduceId: null,
      cotizacionId: row.id,
      codigo: '',
      cotizacionCodigo: row.code || `#${row.id}`,
      // Un conduce nuevo es de hoy, aunque la cotización sea de otro día.
      fecha: hoyLocal(),
      fechaGuardada: '',
      // Con su precio interno, su ITBIS y bien/servicio: los usa Facturar.
      lineas: lineasDeFila(row),
      avisoCargos: avisoCargosConduce(row),
    },
    clientId: row.client_id ?? null,
    clienteNombre: row.client_name || '',
  }
}

function desdeConduce(row: ConduceRow): DocumentoConduce {
  const dia = String(row.date ?? '').slice(0, 10)
  return {
    datos: {
      conduceId: row.id,
      cotizacionId: null,
      codigo: row.code || `#${row.id}`,
      cotizacionCodigo: row.cotizacion_code || null,
      fecha: dia || hoyLocal(),
      fechaGuardada: dia,
      lineas: lineasDeFila(row),
      avisoCargos: null,
    },
    clientId: row.client_id ?? null,
    // El nombre que se muestra en todas partes: el del cliente, o el guardado si se borró.
    clienteNombre: row.client_name || row.client_name_guardado || '',
  }
}

/**
 * ¿Ya se puede tomar la foto del documento? Con el dato y sin un pedido en
 * vuelo: la caché puede tener una versión vieja que se está refrescando.
 */
const listoParaUsar = <T,>(q: ApiQueryState<T>): boolean => q.data != null && !q.fetching && q.error == null

function EditorDesdeCotizacion({ nav, cotizacionId }: { nav: Nav; cotizacionId: number }) {
  // Misma clave y el mismo dato crudo (CotizacionRow | null) que CotizacionEditor.
  const detalle = useApiQuery(['cotizaciones', 'detail', cotizacionId], () => getCotizacion(cotizacionId))
  const fila = useRef<CotizacionRow | null>(null)
  if (fila.current == null && listoParaUsar(detalle)) fila.current = detalle.data

  if (fila.current != null) {
    // Una de Gratex no tiene unidades ni productos: no hay conduce que sacar.
    if (formatoDeFila(fila.current) !== 'ferreteria') {
      return (
        <Marco nav={nav} desde="cotizaciones">
          <EmptyState
            icon="file-plus"
            title={MSG_SOLO_FERRETERIA}
            action={
              <Btn variant="secondary" icon="arrow-left" onClick={() => nav('cotizaciones', null, { replace: true })}>
                Ir a cotizaciones
              </Btn>
            }
          >
            Esta cotización se guardó con otro formato.
          </EmptyState>
        </Marco>
      )
    }
    return <ConClienteResuelto nav={nav} doc={desdeCotizacion(fila.current)} />
  }
  if (detalle.error != null && !detalle.fetching) {
    return (
      <Marco nav={nav} desde="cotizaciones">
        <ErrorState title="No se pudo cargar la cotización" onRetry={() => void detalle.reload()}>
          {detalle.error}
        </ErrorState>
      </Marco>
    )
  }
  if (detalle.loading || detalle.fetching) return <Marco nav={nav} desde="cotizaciones"><LoadingState rows={6} /></Marco>
  // El backend respondió sin fila: la borraron (otro usuario, otra pestaña) o el enlace es viejo.
  return (
    <Marco nav={nav} desde="cotizaciones">
      <EmptyState
        icon="file-plus"
        title={MSG_COTIZACION_NO_EXISTE}
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

/**
 * Un conduce nuevo sin cotización: sin cliente, sin líneas y fechado hoy. No
 * lee nada, así que no pasa por ConClienteResuelto: con `clientId` null ese
 * camino diría "El cliente ya no existe" (clienteBorrado), y aquí nunca hubo
 * cliente. El número queda en "Se asigna al guardar", como el de uno nuevo
 * desde una cotización. Las líneas del catálogo traen su precio como precio
 * interno (lineaDesdeProducto, desde el formulario) y las libres no lo traen:
 * Facturar lo pide después, con su bloqueo del precio 0.
 */
function EditorEnBlanco({ nav }: { nav: Nav }) {
  // Una sola vez: el formulario toma `inicial` al montarse, y la fecha no cambia
  // porque se pinte de nuevo (ni por pasar la medianoche con el formulario abierto).
  const [inicial] = useState<InicialConduce>(() => ({
    conduceId: null,
    cotizacionId: null,
    codigo: '',
    cotizacionCodigo: null,
    fecha: hoyLocal(),
    fechaGuardada: '',
    lineas: [],
    cliente: null,
    clienteCompleto: true,
    clienteBorrado: false,
    avisoCargos: null,
  }))
  return <ConduceForm nav={nav} inicial={inicial} />
}

function EditorExistente({ nav, conduceId }: { nav: Nav; conduceId: number }) {
  const detalle = useApiQuery(['conduces', 'detail', conduceId], () => getConduce(conduceId))
  const fila = useRef<ConduceRow | null>(null)
  if (fila.current == null && listoParaUsar(detalle)) fila.current = detalle.data

  if (fila.current != null) return <ConClienteResuelto nav={nav} doc={desdeConduce(fila.current)} />
  if (detalle.error != null && !detalle.fetching) {
    return (
      <Marco nav={nav} desde="conduces">
        <ErrorState title="No se pudo cargar el conduce" onRetry={() => void detalle.reload()}>
          {detalle.error}
        </ErrorState>
      </Marco>
    )
  }
  if (detalle.loading || detalle.fetching) return <Marco nav={nav} desde="conduces"><LoadingState rows={6} /></Marco>
  // Sin fila: se eliminó (activo = 0) o el enlace es viejo. El backend responde [] en los dos casos.
  return (
    <Marco nav={nav} desde="conduces">
      <EmptyState
        icon="truck"
        title={MSG_CONDUCE_NO_EXISTE}
        action={
          <Btn variant="secondary" icon="arrow-left" onClick={() => nav('conduces', null, { replace: true })}>
            Ir a conduces
          </Btn>
        }
      >
        Puede que alguien lo haya eliminado.
      </EmptyState>
    </Marco>
  )
}

/** Cliente con que abre el formulario, o null mientras no se sabe. */
function clienteInicial(
  doc: DocumentoConduce,
  ficha: ApiQueryState<ClientRow | null>,
): Pick<InicialConduce, 'cliente' | 'clienteCompleto' | 'clienteBorrado'> | null {
  // Sin client_id: el cliente se borró (o la cotización nunca lo tuvo). (El conduce
  // en blanco no pasa por aquí: ver EditorEnBlanco.)
  if (doc.clientId == null) return { cliente: null, clienteCompleto: true, clienteBorrado: true }
  if (ficha.loading || ficha.fetching) return null
  // 404: el cliente se borró después. El conduce guarda su nombre, pero para
  // volver a guardarlo hace falta uno que exista (el backend lo exige).
  if (ficha.errorStatus === 404) return { cliente: null, clienteCompleto: true, clienteBorrado: true }
  if (ficha.data) return { cliente: mapClientRow(ficha.data), clienteCompleto: true, clienteBorrado: false }
  // No se pudo leer (red, servidor): la ficha provisional con el id y el
  // nombre del documento. Guardar sigue funcionando; solo falta el RNC en pantalla.
  return {
    cliente: clienteDeFila({ client_id: doc.clientId, client_name: doc.clienteNombre }),
    clienteCompleto: false,
    clienteBorrado: false,
  }
}

function ConClienteResuelto({ nav, doc }: { nav: Nav; doc: DocumentoConduce }) {
  const clientId = doc.clientId
  // Misma clave y el mismo dato que el formulario de la cotización: si ya se leyó, no se vuelve a pedir.
  const ficha = useApiQuery(['clients', 'detail', clientId], () => (clientId ? getClient(clientId) : Promise.resolve(null)))
  const inicial = useRef<InicialConduce | null>(null)
  if (inicial.current == null) {
    const cli = clienteInicial(doc, ficha)
    if (cli) inicial.current = { ...doc.datos, ...cli }
  }

  if (inicial.current) return <ConduceForm nav={nav} inicial={inicial.current} />
  return (
    <Marco nav={nav} desde={doc.datos.conduceId != null ? 'conduces' : 'cotizaciones'}>
      <LoadingState rows={6} />
    </Marco>
  )
}
