// Facturas, el inicio de la app (anexo 6.2): dos tiles (HOY y ESTE MES), a lo sumo dos avisos, la búsqueda, los chips de estado (y de tipo, en una cuenta con varios) y el historial en
// tarjetas. Buscar o elegir un chip pliega los tiles y los avisos. Es la pantalla de `#/facturas?q=&estado=&tipo=`: los filtros viven en el hash (con reemplazo, sin llenar el historial)
// y de ahí sale la lista.
//
// Cada sección se dibuja sola, con su propio estado (cargando, error, listo): la lista no espera a las estadísticas y los tiles no esperan a los avisos.
//  - La lista es un `useInfiniteQuery` de 15 filas por página, con `lean` y `archivadas=0` (lib/paginas.ts oculta lo archivado por si el API todavía no lo entiende y pide la página siguiente
//    sola cuando lo que se ve no llega a una página: nunca un vacío falso). Las estadísticas y los avisos se piden DESPUÉS de que la lista pintó algo (filas o su error): no compiten con ella
//    por el primer pintado (anexo 15.4). La barra inferior lee estas mismas consultas para su insignia y su punto (shell/BarraInferior.tsx) sin adelantarlas.
//  - Los vacíos salen solo de `estadoVacio`, con `resumen.total_ecf` de las estadísticas, y solo con una lista cargada y sin una página siguiente en camino.
//  - Sin conexión y con filas de esta sesión de la página: se ven apagadas con «Datos de hace N min (sin actualizar)». Sin filas, el error de siempre.
//  - Una lectura que pasa de `LECTURA_LENTA_MS` dice «Tarda más de lo normal» y sigue esperando: nada se aborta (`getList` no toma un `signal`).
//
// Se actualiza con el icono de la cabecera, al volver a la app tras `REFRESCO_VISIBLE_MS` oculta y al volver de un detalle (u otra pestaña) con datos ya en la caché: invalidar
// `['facturas']`, `['stats']` y `['avisos']` recarga lo que está a la vista. No hay sondeo con el paso del tiempo ni gesto de jalar para actualizar. En Pendientes, «Verificar» pregunta a la
// DGII, de a una, por las primeras tres facturas en proceso (los cuatro estados del grupo «En proceso»: ENVIADO, EN_PROCESO y sus RFCE_) y recarga: la lista nunca pide el estado por fila.
//
// La ruta llega como propiedad (`registro` se la pasa) y no de `useRuta`: con Más abierto, `useRuta` dice `mas` y la pantalla de detrás tiene que seguir con sus filtros.
import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import type { InvalidateOptions, QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errores'
import { FRESCURA } from '@/config/cache'
import { useSession } from '@/stores/auth'
import { LECTURA_LENTA_MS, PAGINA, REFRESCO_VISIBLE_MS } from '~/config'
import { esAdmin, esMultiTipo, leerEntitlements, tiposFiltro } from '~/entitlements'
import type { UsuarioExpress } from '~/entitlements'
import { calcularAlertas, tilesDe } from '~/lib/alertas'
import type { Alerta } from '~/lib/alertas'
import { bucketDe, etiquetaAmbiente } from '~/lib/etiquetas'
import { normalizarFactura } from '~/lib/filas'
import type { FacturaVista } from '~/lib/filas'
import { estadoVacio, necesitaMasPaginas, visibles } from '~/lib/paginas'
import type { EstadoVacio, PaginaFacturas } from '~/lib/paginas'
import { hoy } from '~/lib/reloj'
import { refrescarMe, snapshot } from '~/lib/sesion'
import { nombreTipo } from '~/lib/tiposEcf'
import { useAlVolver, useEnLinea } from '~/net/enLinea'
import { claves, getAvisos, getEstado, getStatsLight, listFacturas } from '~/net/lecturas'
import { navegar } from '~/router'
import type { Ruta } from '~/router'
import { Banner } from '~/ui/Banner'
import { Button } from '~/ui/Button'
import { Cabecera } from '~/ui/Cabecera'
import { EmptyState } from '~/ui/EmptyState'
import { Icon } from '~/ui/Icon'
import { Skeleton } from '~/ui/Skeleton'
import { mostrarToast } from '~/ui/Toast'
import { Alertas } from './facturas/Alertas'
import { Busqueda } from './facturas/Busqueda'
import { Filtros } from './facturas/Filtros'
import type { GrupoDeFiltro, OpcionDeFiltro } from './facturas/Filtros'
import { TarjetaFactura } from './facturas/TarjetaFactura'
import { Tiles } from './facturas/Tiles'
import type { EstadoDeTiles } from './facturas/Tiles'
import './Facturas.css'

type RutaFacturas = Extract<Ruta, { id: 'facturas' }>
type FiltrosDeLaPantalla = { q: string; estado: string; tipo: string }

/** Facturas sin filtros: lo que se usa si la ruta que llega no es la de Facturas. `registro` nunca la manda, pero su tipo (`Ruta`) no lo dice. */
const INICIO: RutaFacturas = { id: 'facturas' }

/** Cuántas facturas consulta «Verificar» de una vez (anexo 6.2). */
const MAX_VERIFICAR = 3

/** El alto de una tarjeta sencilla de la lista (cliente, número y total, sin líneas de vínculo), en px: el del esqueleto, para que las filas que llegan ocupen el sitio que se les guardó. */
const ALTO_DE_TARJETA = 104

/** Cada cuánto se dibuja de nuevo el «hace N min» de «sin conexión» mientras dura. */
const MEDIO_MINUTO_MS = 30_000

const SIN_PAGINAS: PaginaFacturas[] = []
const SIN_ALERTAS: { visibles: Alerta[]; extra: number } = { visibles: [], extra: 0 }

/** Los chips de estado: lo que se escribe en el hash (`estado`) y el texto del chip, que también dice «No hay facturas en ...». Todas es sin `estado`. */
const ESTADOS: OpcionDeFiltro[] = [
  { valor: '', etiqueta: 'Todas' },
  { valor: 'pendiente', etiqueta: 'Pendientes' },
  { valor: 'accion', etiqueta: 'Por revisar' },
  { valor: 'aprobado', etiqueta: 'Aceptadas' },
]

/** Las notas van en plural en el filtro (son varias facturas); los demás tipos llevan su nombre de `nombreTipo`. */
const PLURAL_EN_FILTRO = new Map([
  ['33', 'Notas de débito'],
  ['34', 'Notas de crédito'],
])
const etiquetaDeTipo = (codigo: string): string => PLURAL_EN_FILTRO.get(codigo) ?? nombreTipo(codigo)

// Lo que se invalida: la lista (y todo lo de una factura, que cuelga de `['facturas']`), las estadísticas y los avisos; una verificación solo toca las dos primeras.
const DEL_INICIO: ReadonlyArray<readonly string[]> = [['facturas'], ['stats'], ['avisos']]
const DE_UNA_VERIFICACION: ReadonlyArray<readonly string[]> = [['facturas'], ['stats']]

function invalidar(cliente: QueryClient, prefijos: ReadonlyArray<readonly string[]>, opciones?: InvalidateOptions): void {
  for (const queryKey of prefijos) void cliente.invalidateQueries({ queryKey }, opciones)
}

// --- Lo que se pide al API ----------------------------------------------------------------------------------------------------

/** Una página de la lista con sus filas ya leídas (lib/filas): lo que guarda la caché. La página que dice el API; si no manda la paginación, la pedida y sin saber cuántas hay. */
async function leerPagina(pagina: number, f: { estado: string; tipo: string; query: string }): Promise<PaginaFacturas> {
  const r = await listFacturas({ page: pagina, pageSize: PAGINA, query: f.query, estado: f.estado, tipo_ecf: f.tipo, lean: true, archivadas: false })
  return { items: r.items.map(normalizarFactura), page: r.page ?? pagina, totalPages: r.totalPages ?? null }
}

/** La página que sigue según `pagination.totalPages`; ninguna si no hay más o si el API no mandó la paginación (no se pide a ciegas una página que quizá no existe). */
const paginaSiguiente = (ultima: PaginaFacturas): number | undefined => (ultima.totalPages !== null && ultima.page < ultima.totalPages ? ultima.page + 1 : undefined)

// --- Leer lo que llegó --------------------------------------------------------------------------------------------------------

/** Una propiedad de lo que mandó el API (`unknown`); undefined si lo que llegó no es un objeto. */
const campo = (v: unknown, clave: string): unknown => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[clave] : undefined)

/**
 * `resumen.total_ecf` de las estadísticas: cuántas facturas tiene la empresa. null si no llegó o no es un número: sin la cifra no se afirma que nunca ha emitido nada (`estadoVacio`).
 * PDO manda los enteros como texto a veces, y se leen.
 */
function totalEmitidas(stats: unknown): number | null {
  const bruto = campo(campo(stats, 'resumen'), 'total_ecf')
  const n = typeof bruto === 'number' ? bruto : typeof bruto === 'string' && bruto.trim() !== '' ? Number(bruto) : NaN
  return Number.isFinite(n) ? n : null
}

/** ¿Es el 403 del plan (`codigo` EDICION_NO_INCLUYE)? Se mira el código y no el texto (4.3(b)): el texto es para el usuario. */
const esEdicionNoIncluye = (error: unknown): boolean => error instanceof ApiError && error.status === 403 && error.codigo === 'EDICION_NO_INCLUYE'

/** Las filas sin repetir por `id`, en su orden: con la lista cambiando entre una página y otra, una factura puede venir al final de una y al principio de la siguiente. */
function sinRepetidas(filas: FacturaVista[]): FacturaVista[] {
  const vistas = new Set<number>()
  return filas.filter((f) => {
    if (vistas.has(f.id)) return false
    vistas.add(f.id)
    return true
  })
}

/** La ruta de Facturas con estos filtros, sin los vacíos: la forma en que se escriben en el hash. */
function rutaConFiltros(f: FiltrosDeLaPantalla): RutaFacturas {
  const ruta: RutaFacturas = { id: 'facturas' }
  if (f.q !== '') ruta.q = f.q
  if (f.estado !== '') ruta.estado = f.estado
  if (f.tipo !== '') ruta.tipo = f.tipo
  return ruta
}

// --- Ganchos de la pantalla ---------------------------------------------------------------------------------------------------

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

/** Mientras `activo`, dibuja de nuevo cada medio minuto: el «hace N min» de un aviso tiene que seguir el reloj aunque nada más cambie. */
function useRepintarCadaMedioMinuto(activo: boolean): void {
  const [, repintar] = useState(0)
  useEffect(() => {
    if (!activo) return
    const reloj = window.setInterval(() => repintar((n) => n + 1), MEDIO_MINUTO_MS)
    return () => window.clearInterval(reloj)
  }, [activo])
}

// --- La pantalla --------------------------------------------------------------------------------------------------------------

export default function Facturas(p: { ruta: Ruta }): JSX.Element {
  const ruta: RutaFacturas = p.ruta.id === 'facturas' ? p.ruta : INICIO
  const estado = ruta.estado ?? ''
  const tipo = ruta.tipo ?? ''
  const q = ruta.q ?? ''
  const consulta = q.trim() // lo que se busca: el espacio del final es de quien teclea, no del servidor

  // La cuenta: con la sesión vencida el store queda vacío y la hoja de sesión se abre sobre esta pantalla, que sigue con la cuenta que tenía (la retenida), como App.
  const { token, user } = useSession()
  const usuario: UsuarioExpress | null = token !== null && user !== null ? user : (snapshot()?.user ?? null)
  const entitlements = useMemo(() => leerEntitlements(usuario), [usuario])
  const admin = esAdmin(usuario)

  const enLinea = useEnLinea()
  const cliente = useQueryClient()
  const hoyLocal = hoy()
  const [escribiendo, setEscribiendo] = useState(consulta !== '')

  // --- Los datos
  const filtrosDeLista = { estado, tipo, query: consulta }
  const lista = useInfiniteQuery({
    queryKey: claves.lista(filtrosDeLista),
    queryFn: ({ pageParam }) => leerPagina(pageParam, filtrosDeLista),
    initialPageParam: 1,
    getNextPageParam: paginaSiguiente,
    staleTime: FRESCURA.VOLATIL,
  })
  // Después del primer pintado de la lista (filas, o su error): ni compiten con ella ni la retrasan. Una vez pintada se queda abierta: cambiar de chip vuelve a pedir la lista, no las
  // estadísticas ni los avisos. Con los datos de la lista ya en la caché (volver de un detalle) se abre en el primer efecto.
  const [listaPintada, setListaPintada] = useState(false)
  const hayLista = !lista.isPending
  useEffect(() => {
    if (hayLista) setListaPintada(true)
  }, [hayLista])
  const stats = useQuery({ queryKey: claves.stats, queryFn: getStatsLight, staleTime: FRESCURA.VOLATIL, enabled: listaPintada })
  const avisos = useQuery({ queryKey: claves.avisos, queryFn: getAvisos, staleTime: FRESCURA.VOLATIL, enabled: listaPintada })

  const paginas = lista.data?.pages ?? SIN_PAGINAS
  const filas = useMemo(() => sinRepetidas(visibles(paginas, { ocultarArchivadas: true })), [paginas])
  const necesitaMas = necesitaMasPaginas(paginas, { ocultarArchivadas: true })
  const tiles = useMemo(() => tilesDe(stats.data, hoyLocal), [stats.data, hoyLocal])
  const alertas = useMemo(
    () => (entitlements === null ? SIN_ALERTAS : calcularAlertas({ stats: stats.data, avisos: avisos.data, entitlements, admin, hoy: hoyLocal })),
    [stats.data, avisos.data, entitlements, admin, hoyLocal],
  )

  // --- Qué se ve
  const sinActualizar = !enLinea && lista.data !== undefined
  useRepintarCadaMedioMinuto(sinActualizar)
  // «Hace 1 min» como mínimo: el aviso nunca promete más frescura de la que tiene.
  const minutos = Math.max(1, Math.round((Date.now() - lista.dataUpdatedAt) / 60_000))
  const lenta = useLenta(lista.isFetching)
  const sinPlan = [lista.error, stats.error, avisos.error].some(esEdicionNoIncluye)
  const colapsado = estado !== '' || tipo !== '' || escribiendo
  const estadoTiles: EstadoDeTiles = stats.data !== undefined ? 'listo' : stats.isError || !enLinea ? 'error' : 'cargando'
  const actualizando = lista.isFetching || stats.isFetching || avisos.isFetching
  const ambiente = entitlements !== null && entitlements.tenant.ambiente !== 'ecf' ? etiquetaAmbiente(entitlements.tenant.ambiente) : null
  const porVerificar = filas.filter((f) => bucketDe(f.estado) === 'enProceso').slice(0, MAX_VERIFICAR)
  const [verificando, setVerificando] = useState(false)

  // --- Efectos
  // La lista, sin esperar a nadie, cuando lo que se ve no llega a una página porque el cliente ocultó filas y el API dice que hay otra (Review Focus 4). No con un error: reintentar es del usuario.
  const { fetchNextPage, hasNextPage, isFetching, isError } = lista
  useEffect(() => {
    if (necesitaMas && hasNextPage && !isFetching && !isError) void fetchNextPage()
  }, [necesitaMas, hasNextPage, isFetching, isError, fetchNextPage])

  // Un 403 del plan: la cuenta pudo cambiar de edición, y `/me` trae el bloque al día (App decide qué pantalla le toca con él).
  useEffect(() => {
    if (sinPlan) void refrescarMe()
  }, [sinPlan])

  // Volver de un detalle (o de otra pestaña): lo que había en la caché es de antes, y allá pudo cambiar. `cancelRefetch: false` por si la lista ya se está pidiendo (datos viejos): sigue esa.
  const [volvio] = useState(() => cliente.getQueryData(claves.lista(filtrosDeLista)) !== undefined)
  useEffect(() => {
    if (volvio) invalidar(cliente, DEL_INICIO, { cancelRefetch: false })
  }, [cliente, volvio])

  const refrescar = (): void => invalidar(cliente, DEL_INICIO)
  useAlVolver(REFRESCO_VISIBLE_MS, refrescar)

  // --- Qué hacen los controles
  const filtrar = (cambio: Partial<FiltrosDeLaPantalla>): void => navegar(rutaConFiltros({ q, estado, tipo, ...cambio }), { reemplazar: true })
  const buscar = (texto: string): void => filtrar({ q: texto.trim() === '' ? '' : texto })
  const reintentar = (): void => void (lista.isFetchNextPageError ? lista.fetchNextPage() : lista.refetch())

  /** «Verificar»: pregunta a la DGII por el estado de las primeras tres en proceso, una tras otra, y recarga. Si una falla se para y lo dice: las demás fallarían igual. */
  const verificar = async (): Promise<void> => {
    setVerificando(true)
    try {
      for (const f of porVerificar) await getEstado(f.id)
    } catch (e) {
      mostrarToast(e instanceof ApiError ? e.message : 'No se pudo verificar el estado.', { tipo: 'error' })
    } finally {
      setVerificando(false)
      invalidar(cliente, DE_UNA_VERIFICACION)
    }
  }

  // --- Los chips
  const grupos: GrupoDeFiltro[] = [{ nombre: 'Estado', opciones: ESTADOS, valor: estado, onCambio: (valor) => filtrar({ estado: valor }) }]
  if (esMultiTipo(entitlements)) {
    const opciones = tiposFiltro(entitlements).map((codigo) => ({ valor: codigo, etiqueta: etiquetaDeTipo(codigo) }))
    grupos.push({ nombre: 'Tipo de comprobante', opciones: [{ valor: '', etiqueta: 'Todos los tipos' }, ...opciones], valor: tipo, onCambio: (valor) => filtrar({ tipo: valor }) })
  }
  /** Los chips elegidos como se leen en «No hay facturas en ...». */
  const nombreDelFiltro = [estado === '' ? undefined : ESTADOS.find((o) => o.valor === estado)?.etiqueta, tipo === '' ? undefined : etiquetaDeTipo(tipo)]
    .filter((nombre): nombre is string => nombre !== undefined)
    .join(' · ')

  // --- La lista
  const errorDeLista = (
    <Banner tono="danger" accion={{ etiqueta: 'Reintentar', onClick: reintentar }}>
      No se pudo cargar la lista.
    </Banner>
  )
  const esqueleto = (
    <div aria-busy="true">
      <Skeleton filas={5} alto={ALTO_DE_TARJETA} />
    </div>
  )

  /** El estado vacío de cada razón de `estadoVacio` (lib/paginas.ts): el texto exacto del anexo y lo que se puede hacer ahí. */
  const estadoVacioDe = (razon: EstadoVacio): JSX.Element => {
    switch (razon) {
      case 'primeraVez':
        return <EmptyState icono="file-text" titulo="Aún no has emitido nada" accion={{ etiqueta: 'Crear primera factura', onClick: () => navegar({ id: 'facturar' }) }} />
      case 'sinVisibles':
        return <EmptyState icono="file-text" titulo="No hay facturas para mostrar" accion={{ etiqueta: 'Actualizar', onClick: refrescar }} />
      case 'filtro':
        return <EmptyState icono="file-text" titulo={`No hay facturas en ${nombreDelFiltro}`} accion={{ etiqueta: 'Ver todas', onClick: () => filtrar({ estado: '', tipo: '' }) }} />
      case 'busqueda':
        return <EmptyState icono="search" titulo={`Sin resultados para «${consulta}»`} accion={{ etiqueta: 'Borrar búsqueda', onClick: () => filtrar({ q: '' }) }} />
    }
  }

  let historial: JSX.Element | null
  if (lista.data === undefined) {
    // Sin filas todavía. Sin red la petición queda en pausa y no falla: el esqueleto no se quedaría para siempre, se dice que no se pudo.
    if (esEdicionNoIncluye(lista.error)) historial = null // ya lo dice el aviso de arriba
    else historial = lista.isError || !enLinea ? errorDeLista : esqueleto
  } else if (filas.length > 0) {
    historial = (
      <>
        {lista.isError && !esEdicionNoIncluye(lista.error) && errorDeLista}
        <ul className="tarjetas">
          {filas.map((f) => (
            <li key={f.id}>
              <TarjetaFactura f={f} hoy={hoyLocal} atenuada={sinActualizar} />
            </li>
          ))}
        </ul>
        {lista.hasNextPage && (
          <div className="facturas__mas">
            <Button variante="secundario" bloque cargando={lista.isFetchingNextPage} onClick={() => void lista.fetchNextPage()}>
              Cargar más
            </Button>
          </div>
        )}
      </>
    )
  } else {
    const totalEcf = totalEmitidas(stats.data)
    // Nunca mientras se carga la página siguiente (todavía no se sabe si hay algo), y sin las estadísticas todavía no se escoge entre «Aún no has emitido nada» y «No hay facturas para mostrar»:
    // ni un parpadeo del texto equivocado a quien aún no ha emitido nada.
    const vacio = lista.isFetchingNextPage
      ? null
      : estadoVacio({ totalEcf, filtro: estado !== '' ? estado : tipo, busqueda: consulta, paginas, ocultarArchivadas: true })
    const esperandoCifra = vacio === 'sinVisibles' && totalEcf === null && stats.isPending && enLinea
    if (vacio === null || esperandoCifra) {
      // La página siguiente viene en camino sola; si falló, el aviso de error con su «Reintentar».
      historial = lista.isError && !esEdicionNoIncluye(lista.error) ? errorDeLista : esqueleto
    } else {
      // Facturas.css ensancha el estado vacío: el EmptyState trae su propio relleno de los lados y el de la pantalla ya está puesto.
      historial = <div className="facturas__vacio">{estadoVacioDe(vacio)}</div>
    }
  }

  return (
    <div className="pantalla">
      <Cabecera
        titulo="Facturas"
        derecha={
          <>
            {estado === 'pendiente' && porVerificar.length > 0 && (
              <Button variante="texto" className="facturas__verificar" cargando={verificando} onClick={() => void verificar()}>
                Verificar
              </Button>
            )}
            <button type="button" className={actualizando ? 'facturas__refrescar facturas__refrescar--girando' : 'facturas__refrescar'} aria-label="Actualizar" onClick={refrescar}>
              <Icon name="refresh-cw" />
            </button>
            {ambiente !== null && <span className={`facturas__ambiente facturas__ambiente--${ambiente.tono}`}>{ambiente.texto}</span>}
          </>
        }
      />
      <div className="facturas__cuerpo">
        {sinActualizar && <Banner tono="warning">Sin conexión. Datos de hace {minutos} min (sin actualizar)</Banner>}
        {sinPlan && <Banner tono="danger">Tu plan Express no incluye esta función</Banner>}
        {!colapsado && <Tiles estado={estadoTiles} tiles={tiles} onReintentar={() => void stats.refetch()} />}
        {!colapsado && <Alertas visibles={alertas.visibles} extra={alertas.extra} />}
        <Busqueda q={q} onBuscar={buscar} onEscribiendo={setEscribiendo} />
        <Filtros grupos={grupos} />
        {lenta && <Banner tono="info">Tarda más de lo normal</Banner>}
        {historial}
      </div>
    </div>
  )
}
