// Cómo sabe la app que salió una versión nueva (anexo 5.2: la fila «Hay una versión nueva» de Más). El build escribe `version.json` junto a la app
// (`{ version, construido }`, dev/plugins.mjs), Vercel lo sirve sin caché (vercel.json) y la app compara su BUILD_ID con el `version` que hay allí.
//
// Se pregunta solo al volver a primer plano (`visibilitychange`), a lo sumo cada 10 minutos y nunca con una factura en vuelo o sin confirmar: la app
// no pide nada por su cuenta en medio de un envío. Ver una versión nueva no recarga nada: lo hace «Actualizar», cuando el usuario quiere. La lógica
// vive en `crearVigiaDeVersion`, que recibe el documento y el reloj para poder probarla en Node (sin DOM); `useVersionNueva` es el pegamento de React.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { BUILD_ID } from '~/config'
import { useIndicadoresFacturar } from '~/lib/indicadores'

/** Cada cuánto, a lo sumo, se pregunta si hay una versión nueva. */
export const INTERVALO_VERSION_MS = 10 * 60_000
/** Cuánto se espera la respuesta de /version.json antes de darla por perdida. */
const PLAZO_VERSION_MS = 10_000

/**
 * Los BUILD_ID que no identifican una compilación: vacío, `dev` (lo que vale cuando Vite no define `__BUILD_ID__`, como en las pruebas) y `local`. Con
 * ellos no hay nada que comparar. Una compilación sin git sale `26.10.29-local` (fecha y sha): esa sí es una compilación de un día, y se compara.
 */
const SIN_COMPILACION: readonly string[] = ['', 'dev', 'local']

/**
 * ¿Es `remoto` (el JSON de version.json, como llegó) el de una versión distinta de `actual`? Solo cuenta un objeto con un `version` de texto no vacío; cualquier
 * otra cosa (null, un objeto sin `version`, un número) no dice nada y es que no. Una compilación sin identificar (`dev`, `local`) nunca ve una versión nueva.
 */
export function esVersionNueva(actual: string, remoto: unknown): boolean {
  if (SIN_COMPILACION.includes(actual)) return false
  if (typeof remoto !== 'object' || remoto === null) return false
  const { version } = remoto as { version?: unknown }
  return typeof version === 'string' && version !== '' && version !== actual
}

/** Lo que se usa de `fetch`: así una prueba puede pasarle uno falso. */
type Buscar = (url: string, init: { cache: 'no-store'; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>

/**
 * Pide /version.json al servidor y entrega su JSON. La marca de tiempo salta cualquier caché intermedia y `no-store` evita guardar la respuesta; el plazo
 * es de 10 s. Rechaza ante un fallo de red, un HTTP que no es 2xx o un cuerpo que no es JSON (el shell de un servidor sin version.json): quien llama lo
 * ignora, porque no preguntar bien no es una versión nueva. `ahoraMs` es solo para la marca.
 */
export async function pedirVersionRemota(buscar: Buscar = fetch, ahoraMs: () => number = Date.now): Promise<unknown> {
  const res = await buscar(`/version.json?t=${ahoraMs()}`, { cache: 'no-store', signal: AbortSignal.timeout(PLAZO_VERSION_MS) })
  if (!res.ok) throw new Error('version.json no está disponible')
  return res.json()
}

/** Lo que el vigía usa del `Document`: así una prueba puede pasarle uno falso. */
type DocumentoVisible = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>

export interface VigiaDeVersion {
  /** ¿Ya se vio una versión distinta de la que corre? Una vez que sí, sigue siendo que sí hasta recargar la página: el aviso no se retira. */
  hayNueva(): boolean
  /** Llama a `cb` cuando se ve una versión nueva (lo que `useSyncExternalStore` pide). Devuelve la función que deja de avisar. */
  suscribir(cb: () => void): () => void
  /**
   * Empieza a mirar cuándo la app vuelve a primer plano. `ocupado` dice si hay una factura en vuelo o sin confirmar: entonces no se pregunta, y esa vuelta
   * no cuenta como pregunta. Devuelve la función que deja de mirar. Varias vigilancias de un mismo vigía (dos componentes que usan el gancho) comparten el
   * intervalo y lo que se ve: la primera que pregunta lo gasta para todas.
   */
  vigilar(ocupado: () => boolean): () => void
}

/**
 * Un vigía de la versión: `actual` es el BUILD_ID de esta página, `leerRemota` pide el version.json (`pedirVersionRemota`) y `ahoraMs` es el reloj real
 * con que se mide el intervalo (no el día simulado de lib/reloj). Crearlo no registra nada en `doc`: eso lo hace `vigilar`.
 */
export function crearVigiaDeVersion(deps: {
  actual: string
  doc: DocumentoVisible
  leerRemota(): Promise<unknown>
  ahoraMs?: () => number
}): VigiaDeVersion {
  const { actual, doc, leerRemota } = deps
  const ahoraMs = deps.ahoraMs ?? Date.now
  const oyentes = new Set<() => void>()
  let nueva = false
  /** El instante de la última pregunta que se hizo, haya salido como haya salido: con la red mala no se insiste en cada vuelta. */
  let ultimaPregunta: number | null = null

  const preguntar = async (): Promise<void> => {
    try {
      if (!esVersionNueva(actual, await leerRemota())) return
    } catch {
      return // sin red, o la respuesta no es el JSON de la versión: no es una versión nueva, y se vuelve a mirar al pasar el intervalo
    }
    nueva = true
    for (const aviso of [...oyentes]) aviso()
  }

  return {
    hayNueva: () => nueva,
    suscribir(cb) {
      // Una función propia por suscripción: cancelar una no puede dejar sin aviso a otra suscripción de la misma función.
      const aviso = (): void => cb()
      oyentes.add(aviso)
      return () => {
        oyentes.delete(aviso)
      }
    },
    vigilar(ocupado) {
      const alCambiarLaVisibilidad = (): void => {
        if (doc.visibilityState !== 'visible' || nueva || SIN_COMPILACION.includes(actual) || ocupado()) return
        const ahora = ahoraMs()
        if (ultimaPregunta !== null && ahora - ultimaPregunta < INTERVALO_VERSION_MS) return
        ultimaPregunta = ahora // antes de esperar la respuesta: otra vuelta, u otra vigilancia, no lanza una segunda mientras esta sigue en vuelo
        void preguntar()
      }
      doc.addEventListener('visibilitychange', alCambiarLaVisibilidad)
      return () => doc.removeEventListener('visibilitychange', alCambiarLaVisibilidad)
    },
  }
}

let vigiaDeLaVentana: VigiaDeVersion | undefined

/** El vigía de esta página, creado al usarlo por primera vez: importar el módulo no toca `document`, y las pruebas (Node) lo importan. */
function vigiaGlobal(): VigiaDeVersion {
  if (!vigiaDeLaVentana) vigiaDeLaVentana = crearVigiaDeVersion({ actual: BUILD_ID, doc: document, leerRemota: () => pedirVersionRemota() })
  return vigiaDeLaVentana
}

/**
 * ¿Hay una versión nueva? Verdadero desde que se ve una, hasta recargar la página. Mientras esté montado, mira cuándo la app vuelve a primer plano y
 * pregunta a lo sumo cada 10 minutos, y nunca con `enviando` (una factura en vuelo) o `sinConfirmar` (un registro abierto) en los indicadores de la
 * factura. Lo pueden usar varios componentes a la vez: comparten el vigía.
 */
export function useVersionNueva(): boolean {
  const vigia = vigiaGlobal()
  const { enviando, sinConfirmar } = useIndicadoresFacturar()
  // El vigía lee el valor de ahora, no el de cuando se montó: el efecto de abajo lo deja al día tras cada render, antes del próximo evento.
  const ocupado = useRef(false)
  useEffect(() => {
    ocupado.current = enviando || sinConfirmar !== null
  })
  useEffect(() => vigia.vigilar(() => ocupado.current), [vigia])
  return useSyncExternalStore(vigia.suscribir, vigia.hayNueva)
}
