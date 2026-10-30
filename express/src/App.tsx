// La app (anexo 5.4 y 6.14): decide qué se ve según la sesión y arma el shell. Es el único sitio que mira la sesión para elegir pantalla.
//
//  - Sin token y sin sesión retenida: Login, a pantalla completa. El hash NO se toca: es el destino de regreso, y quien entre vuelve ahí.
//  - Con sesión retenida pero sin token y `useSesionExpirada()`: la sesión venció. El shell sigue montado con la pantalla en que estaba y encima va la hoja de sesión
//    (`SesionSheet`); lo que el usuario tenía a medias no se toca. Al entrar otra vez el token reaparece y la hoja se va sola; si entra otro usuario llega `usuarioCambio`.
//  - Con sesión pero sin bloque de entitlements de Express (`leerEntitlements` da null), o con una cuenta que no puede ni abrir el inicio: la pantalla de edición, a
//    pantalla completa y sin barra.
//  - Si no, la guardia de rutas (`guardia`, entitlements.ts, la única política): `redirigir` se aplica con `reemplazar` y vuelve a pasar por la guardia; `ok` dibuja la
//    pantalla de `registro` dentro del shell: la franja «Sin conexión» y las franjas de la factura en curso arriba, la pantalla (con un esqueleto mientras baja su
//    trozo) y la barra inferior.
//
// Login y Edicion se devuelven cada una sola, con su propio <main>: sin shell, sin barra y sin franjas. El aviso emergente (`ToastHost`) se monta aquí UNA vez, fuera de
// lo que dibujan las rutas y también para Login y Edicion: con dos, cada aviso saldría dos veces.
//
// `#/mas` no es una pantalla sino una hoja: se dibuja la última ruta que no es Más (si se abre Más con un enlace directo, Facturas) y encima `Mas`. La pantalla de detrás
// sigue montada mientras Más está abierto, con su estado y su desplazamiento.
//
// El desplazamiento de la página se recuerda por pestaña (Facturas, Clientes, Productos) en un `Map` del módulo y se restaura cuando esa pestaña vuelve a dibujarse (de un
// detalle, o de otra pestaña); cualquier otra pantalla empieza arriba. Se olvida al cerrar sesión o al entrar otro usuario.
//
// SOLO DEV, detrás de `import.meta.env.DEV` (el build de producción no los trae, ni su CSS): la barra de desarrollo y la galería de primitivas en `#/dev/ui`.
import { lazy, Suspense, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useSession } from '@/stores/auth'
import { esAdmin, guardia, leerEntitlements } from '~/entitlements'
import type { UsuarioExpress } from '~/entitlements'
import { escucharSesion, refrescarMe, snapshot, useSesionExpirada } from '~/lib/sesion'
import { useVersionNueva } from '~/lib/version'
import { formatHash, navegar, parseHash, useRuta } from '~/router'
import type { Ruta } from '~/router'
import Edicion from '~/screens/Edicion'
import Login from '~/screens/Login'
import { rutaTrasEvento } from '~/screens/loginReglas'
import { Mas } from '~/screens/Mas'
import { registro } from '~/screens/registro'
import { SesionSheet } from '~/screens/SesionSheet'
import { BarraInferior } from '~/shell/BarraInferior'
import { Franjas } from '~/shell/Franjas'
import { cuandoAterriceElAtras } from '~/ui/capas'
import { OfflineBanner } from '~/ui/OfflineBanner'
import { Skeleton } from '~/ui/Skeleton'
import { ToastHost } from '~/ui/Toast'
import { useTecladoAbierto } from '~/ui/viewport'
import './App.css'

// En producción `import.meta.env.DEV` es `false` y estas dos constantes quedan en `null`: el `import()` de la rama muerta se descarta y no sale ningún trozo.
const Galeria = import.meta.env.DEV ? lazy(() => import('~/dev/Galeria')) : null
const DevBar = import.meta.env.DEV ? lazy(() => import('~/dev/DevBar')) : null

/** La ruta de una pantalla: cualquiera menos Más, que es una hoja y no tiene pantalla propia en `registro`. */
type RutaDePantalla = Exclude<Ruta, { id: 'mas' }>

/** Las pantallas raíz de las pestañas de la barra: las únicas cuyo desplazamiento se recuerda. */
const RAICES_DE_PESTANA: readonly string[] = ['facturas', 'clientes', 'productos']

/** El desplazamiento de la página (`scrollY`) de cada pestaña, por el id de su raíz. Dura lo que la página y se vacía al cambiar la sesión. */
const desplazamientos = new Map<string, number>()

// --- La galería (solo DEV) ----------------------------------------------------------------------------------------------------

function suscribirHash(avisar: () => void): () => void {
  window.addEventListener('hashchange', avisar)
  return () => window.removeEventListener('hashchange', avisar)
}

const esHashDeLaGaleria = (): boolean => location.hash === '#/dev/ui'

/** ¿Está el hash en `#/dev/ui`? La galería no es una ruta de la app (`parseHash` la leería como Facturas), así que se mira el hash tal cual. */
function useGaleriaDeDesarrollo(): boolean {
  return useSyncExternalStore(suscribirHash, esHashDeLaGaleria)
}

/** En producción el gancho no mira nada: `useGaleriaDeDesarrollo` queda sin uso y se descarta con el resto de lo que es solo de DEV. */
const useGaleriaActiva: () => boolean = import.meta.env.DEV ? useGaleriaDeDesarrollo : () => false

// --- El shell con sesión ------------------------------------------------------------------------------------------------------

function Autenticada(p: { usuario: UsuarioExpress; expirada: boolean }): JSX.Element {
  const { usuario, expirada } = p
  const ruta = useRuta()
  const tecladoAbierto = useTecladoAbierto()
  // Mantiene viva la vigilancia de la versión mientras la app esté abierta, no solo con Más abierto; Más lee el mismo vigía (lib/version.ts: comparten uno solo).
  useVersionNueva()
  const entitlements = useMemo(() => leerEntitlements(usuario), [usuario])

  // La pantalla de detrás de Más: la última ruta que no fue Más. Se guarda en una referencia que un efecto deja al día tras cada dibujo, y se lee al dibujar: cuando la ruta
  // pasa a Más, el efecto del dibujo anterior ya la dejó con la pantalla en que se estaba. NO es un `useState` ajustado al dibujar (`if (...) setFondo(ruta)`): un componente
  // que lee la ruta con `useSyncExternalStore` (lo hace `useRuta`) y además actualiza estado mientras se dibuja pierde la actualización de su suscripción, y el siguiente
  // cambio a un hash igual al que quedó guardado ya no lo dibuja (Más no se abría la segunda vez). Con un enlace directo a `#/mas` todavía no hay ninguna, y el fondo es Facturas.
  const ultimaPantalla = useRef<RutaDePantalla>(ruta.id === 'mas' ? { id: 'facturas' } : ruta)
  const pantalla: RutaDePantalla = ruta.id === 'mas' ? ultimaPantalla.current : ruta
  useEffect(() => {
    if (ruta.id !== 'mas') ultimaPantalla.current = ruta
  })

  // La guardia se aplica a la pantalla que de verdad se dibuja: Más no pide nada, pero la pantalla de detrás sí (una cuenta Express sin Facturación no la ve ni detrás).
  const decision = guardia(pantalla, { entitlements, admin: esAdmin(usuario) })
  const redireccion = decision.kind === 'redirigir' ? decision.hash : null
  useEffect(() => {
    // El hash que no se puede abrir no queda en el historial (`reemplazar`), y la ruta nueva vuelve a pasar por la guardia.
    if (redireccion !== null) navegar(parseHash(redireccion), { reemplazar: true })
  }, [redireccion])

  // Los avisos de la sesión que cambia de manos. `rutaActual` es la ruta de ahora, no la de cuando se suscribió.
  const rutaActual = useRef(ruta)
  useEffect(() => {
    rutaActual.current = ruta
  })
  useEffect(
    () =>
      escucharSesion((evento) => {
        desplazamientos.clear() // lo que se recordó es de la sesión que termina
        const destino = rutaTrasEvento(evento, rutaActual.current)
        if (destino === null) return
        // Cuando entra otro usuario por la hoja de sesión, la entrada del historial de esa hoja es la actual y la hoja se cierra con este mismo cambio de sesión: se navega
        // cuando su atrás aterriza, no con la entrada de la hoja puesta (ui/capas.ts).
        cuandoAterriceElAtras(() => navegar(destino, { reemplazar: true }))
      }),
    [],
  )

  // El desplazamiento. Las pestañas se identifican por su raíz (cambiar la búsqueda de Facturas no es otra pantalla); las demás, por su hash entero (un detalle y otro son
  // pantallas distintas, con su propio estado y su propio comienzo).
  const esRaiz = RAICES_DE_PESTANA.includes(pantalla.id)
  const claveDePantalla = esRaiz ? pantalla.id : formatHash(pantalla)
  // `useEffect` y no `useLayoutEffect`: un cambio de ruta es una actualización síncrona y React vacía sus efectos antes de pintar, así que no hay un cuadro en el sitio
  // equivocado; y en un commit los efectos se arman DESPUÉS de que corren todas las limpiezas. Cuando una fila de Más cambia de pantalla, la limpieza de la hoja libera el
  // bloqueo de scroll de iOS 15 y devuelve la página a donde estaba (ui/viewport.ts): este efecto, que va después, es el que deja la pantalla nueva arriba.
  useEffect(() => {
    window.scrollTo(0, desplazamientos.get(claveDePantalla) ?? 0)
  }, [claveDePantalla])
  useEffect(() => {
    if (!esRaiz) return
    const guardar = (): void => {
      desplazamientos.set(claveDePantalla, window.scrollY)
    }
    window.addEventListener('scroll', guardar, { passive: true })
    return () => window.removeEventListener('scroll', guardar)
  }, [esRaiz, claveDePantalla])

  const hojaDeSesion = expirada ? <SesionSheet /> : null
  if (decision.kind === 'edicion' || entitlements === null) {
    return (
      <>
        <Edicion />
        {hojaDeSesion}
      </>
    )
  }

  const Pantalla = registro[pantalla.id]
  const abierta = decision.kind === 'ok' // con una redirección pendiente no se dibuja lo que la guardia niega, ni un cuadro
  // La barra no sale en el asistente (tiene su propia barra de acción) ni con el teclado abierto; en Login y Edicion ni se llega aquí.
  const conBarra = !pantalla.id.startsWith('facturar') && !tecladoAbierto
  return (
    <>
      {DevBar !== null && (
        <Suspense fallback={null}>
          <DevBar />
        </Suspense>
      )}
      <OfflineBanner />
      <Franjas />
      <main>
        <Suspense
          fallback={
            <div className="shell__espera" aria-busy="true">
              <Skeleton filas={5} />
            </div>
          }
        >
          {abierta && <Pantalla key={claveDePantalla} ruta={pantalla} />}
        </Suspense>
      </main>
      {conBarra && <BarraInferior entitlements={entitlements} />}
      {ruta.id === 'mas' && abierta && <Mas usuario={usuario} entitlements={entitlements} />}
      {hojaDeSesion}
    </>
  )
}

// --- La app -------------------------------------------------------------------------------------------------------------------

export default function App(): JSX.Element {
  // `useSession` y `useSesionExpirada` van primero, y `snapshot()` se lee en este mismo dibujo, después de ellos: no es reactiva (lib/sesion.ts), y lo que el store avise
  // llega por esos dos ganchos. No se guarda ni se memoiza: una copia vieja mostraría la hoja de sesión sobre el usuario equivocado.
  const { token, user } = useSession()
  const expirada = useSesionExpirada()
  const retenida = snapshot()
  const enGaleria = useGaleriaActiva()

  // Con una sesión guardada en el teléfono, al abrir se piden al día el rol, los permisos y los entitlements: el bloque guardado pudo cambiar. Sin sesión no hace nada.
  useEffect(() => {
    void refrescarMe()
  }, [])

  // El usuario que se muestra: el de la sesión viva, o, con el token perdido, el retenido (así la pantalla no se vacía bajo la hoja de sesión).
  const usuario: UsuarioExpress | null = token !== null && user !== null ? user : (retenida?.user ?? null)

  let contenido: JSX.Element
  if (enGaleria && Galeria !== null) {
    contenido = (
      <Suspense fallback={null}>
        <Galeria />
      </Suspense>
    )
  } else if (usuario === null) {
    contenido = <Login />
  } else {
    contenido = <Autenticada usuario={usuario} expirada={expirada} />
  }

  return (
    <>
      {contenido}
      <ToastHost />
    </>
  )
}
