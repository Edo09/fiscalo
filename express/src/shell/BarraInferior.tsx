// La barra inferior de Express (anexo 5.1): cinco lugares en orden fijo (Facturas, Clientes, Facturar, Productos, Más), 56 px más el área segura, sin objetivo táctil
// de menos de 48x48. Qué pestañas salen lo decide `construirBarra` (nav.ts) y cómo se reparten, `mitadesBarra`: dos mitades de igual ancho alrededor del botón
// elevado de Facturar, así queda centrado aunque falte Clientes o Productos. Que una pestaña no salga no es un control de seguridad (lo es la guardia de rutas).
//
// La pestaña activa se ve por cuatro cosas, nunca solo por el color: el acento, la letra en negrita, un indicador de 3x24 px y `aria-current="page"`. Es la
// pestaña de la pantalla en que se está: el detalle de una factura es de Facturas, un cliente es de Clientes, Más y sus pantallas son de Más.
//
// Qué hace un toque:
//  - una pestaña distinta: `irATab` (router.ts) decide si empuja una entrada, reemplaza la actual o retrocede, y `precargarRuta` baja el trozo de su pantalla en el
//    `pointerdown`, antes de que el dedo suba;
//  - la pestaña en cuya raíz ya se está: sube al principio y, en Facturas, borra la búsqueda `q` (los filtros se quedan);
//  - desde una pantalla de la pestaña (un detalle) o desde otra: va a su raíz, como cualquier cambio de pestaña;
//  - Más abre la hoja: empuja `#/mas` (la hoja es una ruta; `accionHoja('abrir')`, cuyo resultado es siempre empujar).
// El botón elevado lleva el punto del borrador (`borrador`) y, mientras hay una emisión en vuelo (`enviando`), un aro que gira (solo CSS, con `aria-busy`).
// La insignia con la cuenta de Facturas y el punto de Más se anclan al contenedor del icono (`.barra__icono`): la insignia es `badgeFacturas` y el punto, `puntoMas` (lib/alertas.ts),
// los dos sobre las consultas de estadísticas y avisos que Facturas ya trae (`useResumenDeLaBarra`). Ninguno se lee solo por el color: la insignia dice la cuenta y su texto de lector
// de pantalla va en el `aria-label` de la pestaña; el punto lleva su texto oculto como descripción.
//
// App no la dibuja en el asistente (que tiene su propia barra de acción), con el teclado abierto, en Login ni en la pantalla de edición.
import { useId, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FRESCURA } from '@/config/cache'
import { useSession } from '@/stores/auth'
import { useRuta, irATab, navegar } from '~/router'
import type { Ruta } from '~/router'
import { esAdmin } from '~/entitlements'
import type { Entitlements, UsuarioExpress } from '~/entitlements'
import { badgeFacturas, calcularAlertas, puntoMas } from '~/lib/alertas'
import { useIndicadoresFacturar } from '~/lib/indicadores'
import { hoy } from '~/lib/reloj'
import { snapshot } from '~/lib/sesion'
import { useVersionNueva } from '~/lib/version'
import { construirBarra, mitadesBarra } from '~/nav'
import type { Slot, SlotId } from '~/nav'
import { claves, getAvisos, getStatsLight } from '~/net/lecturas'
import { precargarRuta } from '~/screens/registro'
import { Icon } from '~/ui/Icon'
import type { IconName } from '~/ui/Icon'
import './BarraInferior.css'

/** La insignia de la pestaña Facturas: `badgeFacturas` cuando hay algo que contar. */
type Insignia = NonNullable<ReturnType<typeof badgeFacturas>>

/** Una propiedad de lo que mandó el API (`unknown`); undefined si lo que llegó no es un objeto. */
const campo = (v: unknown, clave: string): unknown => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[clave] : undefined)

/** La pestaña a la que pertenece una ruta (anexo 5.1): su raíz y las pantallas que cuelgan de ella. El asistente es del botón central; Más y sus pantallas, de Más. */
function pestanaDe(r: Ruta): SlotId {
  switch (r.id) {
    case 'facturas':
    case 'factura':
    case 'anular':
      return 'facturas'
    case 'clientes':
    case 'cliente-nuevo':
    case 'cliente':
      return 'clientes'
    case 'productos':
    case 'producto':
      return 'productos'
    case 'facturar':
    case 'facturar-productos':
    case 'facturar-revisar':
    case 'facturar-resultado':
      return 'facturar'
    case 'mas':
    case 'mas-empresa':
    case 'mas-numeracion':
    case 'mas-usuarios':
      return 'mas'
  }
}

/**
 * Lo que la barra cuenta de lo que Facturas ya trae: la insignia de Facturas (`badgeFacturas`, de `por_estado`) y el punto de Más (`puntoMas`).
 *
 * Lee las MISMAS consultas que la pantalla (`claves.stats` y `claves.avisos`): una sola petición y una sola caché. Pero no las inicia: Facturas las pide después de pintar su lista
 * (anexo 15.4), y pedirlas desde aquí, que se monta con ella, se las adelantaría. Así que están apagadas (`enabled`) hasta que haya datos en la caché, y desde entonces la barra las
 * mantiene al día: se vuelven a pedir cuando algo las invalida, como al volver de un detalle. Hasta que Facturas las trae no hay nada que contar. La barra no vuelve a pedirlas por su
 * cuenta (como la pantalla, no hay refresco automático): en otra pestaña la cuenta puede ir por detrás hasta que se vuelva a Facturas.
 *
 * El punto de Más es solo para los avisos de numeración (los que solo el administrador resuelve): se calculan con las reglas de siempre pero sin las cuentas por estado, así un aviso de
 * numeración que no cabe entre los dos que Facturas muestra (el tercero, el cuarto...) también enciende el punto. La sesión retenida da el administrador cuando la hoja de sesión
 * está abierta y el store sin token (como en App).
 */
function useResumenDeLaBarra(entitlements: Entitlements): { insignia: Insignia | null; punto: boolean } {
  const cliente = useQueryClient()
  const { token, user } = useSession()
  const usuario: UsuarioExpress | null = token !== null && user !== null ? user : (snapshot()?.user ?? null)
  const admin = esAdmin(usuario)
  const versionNueva = useVersionNueva()
  const stats = useQuery({ queryKey: claves.stats, queryFn: getStatsLight, staleTime: FRESCURA.VOLATIL, enabled: cliente.getQueryData(claves.stats) !== undefined })
  const avisos = useQuery({ queryKey: claves.avisos, queryFn: getAvisos, staleTime: FRESCURA.VOLATIL, enabled: cliente.getQueryData(claves.avisos) !== undefined })

  const hoyLocal = hoy()
  const secuencias = campo(stats.data, 'secuencias')
  const avisosDeNumeracion = useMemo(
    () => calcularAlertas({ stats: { secuencias }, avisos: avisos.data, entitlements, admin, hoy: hoyLocal }).visibles,
    [secuencias, avisos.data, entitlements, admin, hoyLocal],
  )
  return { insignia: badgeFacturas(campo(stats.data, 'por_estado')), punto: puntoMas({ alertas: avisosDeNumeracion, versionNueva, admin }) }
}

/**
 * Una pestaña de las dos mitades: el icono de 24 px y la etiqueta de 12/600 en una línea (con puntos suspensivos si no cabe; el nombre completo va en `aria-label`).
 * Con `insignia` el `aria-label` es el de la insignia («Facturas, 2 con alertas»), que ya dice el nombre y la cuenta; el número que se ve es solo para quien ve. Con `punto` se
 * dibuja el punto de aviso y su texto oculto es la descripción del botón.
 */
function Pestana(p: { slot: Slot; activa: boolean; onTocar(slot: Slot): void; insignia?: Insignia | null; punto?: boolean }): JSX.Element {
  const { slot, activa, onTocar, insignia = null, punto = false } = p
  const idPunto = useId()
  return (
    <button
      type="button"
      className={activa ? 'barra__tab barra__tab--activa' : 'barra__tab'}
      aria-label={insignia === null ? slot.etiqueta : insignia.etiqueta}
      aria-current={activa ? 'page' : undefined}
      aria-describedby={punto ? idPunto : undefined}
      onPointerDown={() => precargarRuta(slot.id)}
      onClick={() => onTocar(slot)}
    >
      <span className="barra__icono">
        {/* `nav.ts` escribe los nombres de icono como texto; tests/nav.test.ts y tests/iconos.test.ts comprueban que cada uno exista en la tabla. */}
        <Icon name={slot.icono as IconName} />
        {insignia !== null && (
          <span className={`barra__insignia barra__insignia--${insignia.tono}`} aria-hidden="true">
            {insignia.texto}
          </span>
        )}
        {punto && <span className="barra__punto barra__punto--icono" aria-hidden="true" />}
      </span>
      <span className="barra__etiqueta">{slot.etiqueta}</span>
      {punto && (
        <span id={idPunto} className="sr-only">
          Hay avisos
        </span>
      )}
    </button>
  )
}

export function BarraInferior(p: { entitlements: Entitlements }): JSX.Element {
  const ruta = useRuta()
  const idBorrador = useId()
  const { borrador, enviando } = useIndicadoresFacturar()
  const { insignia, punto } = useResumenDeLaBarra(p.entitlements)
  const slots = construirBarra(p.entitlements)
  const { izq, der } = mitadesBarra(slots)
  const central = slots.find((slot) => slot.central)
  const activa = pestanaDe(ruta)

  const tocar = (slot: Slot): void => {
    if (slot.id === 'mas') {
      navegar({ id: 'mas' })
      return
    }
    // Volver a tocar la pestaña en cuya raíz se está: arriba del todo, y en Facturas sin la búsqueda (los chips de estado y de tipo se quedan).
    if (ruta.id === slot.id) {
      window.scrollTo(0, 0)
      if (ruta.id === 'facturas' && ruta.q !== undefined) {
        const sinBusqueda: Extract<Ruta, { id: 'facturas' }> = { id: 'facturas' }
        if (ruta.estado !== undefined) sinBusqueda.estado = ruta.estado
        if (ruta.tipo !== undefined) sinBusqueda.tipo = ruta.tipo
        navegar(sinBusqueda, { reemplazar: true })
      }
      return
    }
    irATab({ id: slot.id })
  }

  return (
    <nav className="barra" aria-label="Principal">
      <div className="barra__mitad">
        {izq.map((slot) => (
          <Pestana key={slot.id} slot={slot} activa={activa === slot.id} onTocar={tocar} insignia={slot.id === 'facturas' ? insignia : null} />
        ))}
      </div>
      {central !== undefined && (
        <div className="barra__centro">
          <button
            type="button"
            className="barra__central"
            aria-label="Nueva factura"
            aria-describedby={borrador ? idBorrador : undefined}
            aria-busy={enviando || undefined}
            onPointerDown={() => precargarRuta(central.id)}
            onClick={() => tocar(central)}
          >
            <Icon name={central.icono as IconName} size={28} />
            {borrador && <span className="barra__punto" aria-hidden="true" />}
          </button>
          {/* El punto del borrador no se ve con un lector de pantalla: su texto va aparte y es la descripción del botón. */}
          {borrador && (
            <span id={idBorrador} className="sr-only">
              Hay un borrador sin emitir
            </span>
          )}
        </div>
      )}
      <div className="barra__mitad">
        {der.map((slot) => (
          <Pestana key={slot.id} slot={slot} activa={activa === slot.id} onTocar={tocar} punto={slot.id === 'mas' && punto} />
        ))}
      </div>
    </nav>
  )
}
