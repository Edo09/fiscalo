// El detalle de una factura (anexo 6.3), la pantalla de `#/facturas/:id`: ver en qué quedó, compartirla y tomar la acción que sigue. Se carga por id (un enlace directo o una recarga funcionan) y cada pieza vive
// en screens/detalle: el encabezado, la tarjeta de lo que la DGII no ha dado por bueno y la línea de tiempo (Estado), las líneas y totales (Lineas), los datos del recibo con su QR (DatosDgii) y los botones (Acciones).
// Qué botones salen lo decide lib/acciones según el estado; nada que se pueda entregar al comprador sale de lo que la DGII no aceptó.
//
//  - Una factura en el aire (en proceso o sin confirmar) se vuelve a consultar sola, con retroceso y solo con la pantalla a la vista (useSondeo); «Verificar estado» pregunta en el acto (verificar.ts). Lo final no se sondea.
//  - Una factura aceptada baja su PDF por adelantado para que «Compartir» lo tenga a mano en el toque (pdf.ts).
//  - Estados de la lectura: esqueleto a los 150 ms, «Tarda más de lo normal» pasados `LECTURA_LENTA_MS` (sin abortar), «No encontramos esta factura», y un error con «Reintentar». Sin conexión y con la factura ya leída, se ve
//    apagada con «Datos de hace N min (sin actualizar)» y lo que necesita la red no corre.
//
// La ruta llega como propiedad (el shell se la pasa) y no de `useRuta`: con Más abierto, `useRuta` dice `mas` y la pantalla de detrás tiene que seguir con la suya.
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/api/errores'
import { FRESCURA } from '@/config/cache'
import { useSession } from '@/stores/auth'
import { LECTURA_LENTA_MS } from '~/config'
import { leerEntitlements } from '~/entitlements'
import type { Ambiente } from '~/entitlements'
import { accionesDe, esSondeable } from '~/lib/acciones'
import { bucketDe } from '~/lib/etiquetas'
import { normalizarFactura } from '~/lib/filas'
import type { FacturaVista } from '~/lib/filas'
import { lineaTiempo } from '~/lib/lineaTiempo'
import { refrescarMe, snapshot } from '~/lib/sesion'
import { useEnLinea } from '~/net/enLinea'
import { claves, getFactura } from '~/net/lecturas'
import { atras } from '~/router'
import type { Ruta } from '~/router'
import { Banner } from '~/ui/Banner'
import { Cabecera } from '~/ui/Cabecera'
import { EmptyState } from '~/ui/EmptyState'
import { Skeleton } from '~/ui/Skeleton'
import { Acciones } from './detalle/Acciones'
import './detalle/acciones-detalle' // registra lo que hace cada acción
import { DatosDgii } from './detalle/DatosDgii'
import { Encabezado, LineaDeTiempo, TarjetaDeEstado } from './detalle/Estado'
import { Lineas } from './detalle/Lineas'
import { usePdfAdelantado } from './detalle/pdf'
import { ReenviarHost } from './detalle/ReenviarHost'
import { useSondeo } from './detalle/useSondeo'
import { useVerificacion } from './detalle/verificar'
import './Detalle.css'

/** La factura de `id` ya leída (lib/filas); null si el API no tiene esa fila. */
async function leerFactura(id: number): Promise<FacturaVista | null> {
  const fila = await getFactura(id)
  return fila === null ? null : normalizarFactura(fila)
}

/** ¿Dijo el API que esa factura no existe (404)? No se reintenta: volvería a decir lo mismo. */
const noExiste = (e: unknown): boolean => e instanceof ApiError && e.status === 404

/** ¿Es el 403 del plan (`codigo` EDICION_NO_INCLUYE)? Se mira el código y no el texto: el texto es para el usuario. */
const esEdicionNoIncluye = (e: unknown): boolean => e instanceof ApiError && e.status === 403 && e.codigo === 'EDICION_NO_INCLUYE'

/** ¿Lleva `activa` más de `LECTURA_LENTA_MS` seguida? Cuenta desde que se enciende y se apaga con ella; no aborta nada. */
function useLenta(activa: boolean): boolean {
  const [lenta, setLenta] = useState(false)
  useEffect(() => {
    if (!activa) {
      setLenta(false)
      return
    }
    const espera = window.setTimeout(() => setLenta(true), LECTURA_LENTA_MS)
    return () => window.clearTimeout(espera)
  }, [activa])
  return activa && lenta
}

/** Lo que se ve de una factura ya leída: todo lo de la pantalla menos la cabecera. Los ganchos del sondeo, de la verificación y del PDF viven aquí porque solo valen con la factura en mano. */
function CuerpoDeLaFactura(p: { f: FacturaVista; ambiente: Ambiente | null; sinConexion: boolean }): JSX.Element {
  const { f, ambiente, sinConexion } = p
  const bucket = bucketDe(f.estado)
  const acciones = useMemo(() => accionesDe(f), [f])
  const pasos = useMemo(() => lineaTiempo(f), [f])
  const sondeo = useSondeo(f.id, esSondeable(bucket))
  const verificacion = useVerificacion(f.id)
  const pdf = usePdfAdelantado(f.id, acciones.mostrarDatosDgii)
  return (
    <>
      <div className={sinConexion ? 'detalle__cuerpo detalle__cuerpo--atenuado' : 'detalle__cuerpo'}>
        <Encabezado f={f} anuladaPor={acciones.anuladaPor} />
        {bucket === 'reemplazada' && <Banner tono="info">Busca {f.numero} en Facturas</Banner>}
        <TarjetaDeEstado aviso={acciones.aviso} f={f} />
        {verificacion.error !== null && <Banner tono="danger">{verificacion.error}</Banner>}
        {sondeo.agotado && <Banner tono="info">Seguimos confirmando. Abre la factura más tarde.</Banner>}
        <LineaDeTiempo pasos={pasos} />
        <Lineas f={f} />
        {acciones.mostrarDatosDgii && <DatosDgii f={f} ambiente={ambiente} />}
        {pdf.estado === 'fallo' && (
          <Banner tono="danger" accion={{ etiqueta: 'Reintentar', onClick: pdf.reintentar }}>
            No se pudo preparar el PDF. Inténtalo de nuevo.
          </Banner>
        )}
        <ReenviarHost />
      </div>
      <Acciones f={f} acciones={acciones} pdf={pdf.estado} verificando={verificacion.preguntando} sinConexion={sinConexion} />
    </>
  )
}

export default function Detalle(p: { ruta: Ruta }): JSX.Element {
  const id = p.ruta.id === 'factura' ? p.ruta.facturaId : 0

  // La cuenta: con la sesión vencida el store queda vacío y la hoja de sesión se abre sobre esta pantalla, que sigue con la cuenta que tenía (la retenida), como App.
  const { token, user } = useSession()
  const usuario = token !== null && user !== null ? user : (snapshot()?.user ?? null)
  const ambiente = useMemo(() => leerEntitlements(usuario)?.tenant.ambiente ?? null, [usuario])

  const enLinea = useEnLinea()
  const consulta = useQuery({
    queryKey: claves.detalle(id),
    queryFn: () => leerFactura(id),
    enabled: id > 0,
    staleTime: FRESCURA.VOLATIL,
    retry: (intentos, e) => !noExiste(e) && intentos < 1,
  })
  const lenta = useLenta(consulta.isFetching && consulta.data === undefined)
  const sinPlan = esEdicionNoIncluye(consulta.error)

  // Un 403 del plan: la cuenta pudo cambiar de edición, y `/me` trae el bloque al día (App decide qué pantalla le toca con él).
  useEffect(() => {
    if (sinPlan) void refrescarMe()
  }, [sinPlan])

  const f = consulta.data ?? null
  const titulo = f !== null && f.numero !== '' ? f.numero : 'Factura'
  // «Hace 1 min» como mínimo: el aviso nunca promete más frescura de la que tiene.
  const minutos = Math.max(1, Math.round((Date.now() - consulta.dataUpdatedAt) / 60_000))
  const sinActualizar = !enLinea && f !== null

  let cuerpo: JSX.Element
  if (id === 0 || consulta.data === null || noExiste(consulta.error)) {
    cuerpo = (
      <EmptyState
        icono="file-text"
        titulo="No encontramos esta factura"
        texto="Puede que ya no exista."
        accion={{ etiqueta: 'Ir a Facturas', onClick: () => atras({ id: 'facturas' }) }}
      />
    )
  } else if (f === null) {
    // Sin la factura todavía. Sin red la petición queda en pausa y no falla: el esqueleto no se quedaría para siempre, se dice que no se pudo.
    if (sinPlan) {
      cuerpo = (
        <div className="detalle__cuerpo">
          <Banner tono="danger">Tu plan Express no incluye esta función</Banner>
        </div>
      )
    } else if (consulta.isError || !enLinea) {
      cuerpo = (
        <div className="detalle__cuerpo">
          <Banner tono="danger" accion={{ etiqueta: 'Reintentar', onClick: () => void consulta.refetch() }}>
            No se pudo cargar la factura.
          </Banner>
        </div>
      )
    } else {
      cuerpo = (
        <div className="detalle__cuerpo" aria-busy="true">
          {lenta && <Banner tono="info">Tarda más de lo normal</Banner>}
          <Skeleton alto={72} filas={4} />
        </div>
      )
    }
  } else {
    cuerpo = <CuerpoDeLaFactura f={f} ambiente={ambiente} sinConexion={sinActualizar} />
  }

  return (
    <div className="pantalla">
      <Cabecera titulo={titulo} atras={{ id: 'facturas' }} />
      {sinActualizar && (
        <div className="detalle__aviso">
          <Banner tono="warning">Sin conexión. Datos de hace {minutos} min (sin actualizar)</Banner>
        </div>
      )}
      {cuerpo}
    </div>
  )
}
