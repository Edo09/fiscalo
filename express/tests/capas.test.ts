// ui/capas: la entrada del historial de cada hoja o selector a pantalla completa. Es lo que el router (router.ts) exige a quien empuje entradas por su
// cuenta: la marca `{ fx, bajo }` del router se conserva (profundidad intacta), el `popstate` solo cierra cuando se sale de la entrada de la propia hoja
// (`navegar` también lanza `popstate`, en el acto y con estado null), y cerrar retrocede por la entrada propia, sin `atras()` ni `marcar()` del router.
// Aquí no hay DOM: se prueba sobre una ventana falsa con historial que se porta como el navegador, y el router real (`crearNavegador`) corre sobre la misma.
import assert from 'node:assert/strict'
import test from 'node:test'
import { crearNavegador } from '~/router'
import { cierraPorArrastre, crearGestorDeCapas, cuandoAterriceElAtras, UMBRAL_ARRASTRE_PX } from '~/ui/capas'
import { esperar } from './ayudas'

interface Entrada {
  hash: string
  state: unknown
}

/**
 * Una ventana falsa con el historial del navegador, lo justo para el router y para las capas. Como en el navegador: `pushState` añade una entrada con la
 * misma URL y sin lanzar `popstate` (borra las de adelante); `back` y `go` recorren el historial después (en un microtask) y lanzan `popstate` con el estado
 * de la entrada a la que llegan; asignar `location.hash` empuja una entrada con estado null y `location.replace` cambia la actual, y las dos lanzan `popstate`
 * EN EL ACTO con estado null (medido en Chromium, informe de la tarea 10) y `hashchange` después. `operaciones` anota cada llamada a la API de historial.
 *
 * Y como Chromium (medido en una página de prueba con StrictMode, que hace `pushState`, `back()` y `pushState` en el mismo turno): el DESTINO de un `back` o
 * `go` se fija al pedirlo, no al aterrizar. Un `pushState` hecho después de `back()` y antes de que este aterrice no lo desplaza: el atrás cae por debajo de
 * la entrada recién empujada, que queda enterrada. Por eso una capa no puede empujar su entrada con un atrás en vuelo.
 * @param opciones `pushStateLanza`: `pushState` lanza SecurityError, como Safari al pasar de 100 llamadas en 30 segundos; `sinAterrizar`: un atrás que nunca
 * llega (ningún `popstate`), para probar que nada se queda esperando para siempre
 */
function ventanaFalsa(entradas: Entrada[], opciones: { pushStateLanza?: boolean; sinAterrizar?: boolean } = {}) {
  let indice = entradas.length - 1
  const oyentes = { popstate: new Set<() => void>(), hashchange: new Set<() => void>() }
  const operaciones: string[] = []
  const emitir = (tipo: 'popstate' | 'hashchange'): void => {
    for (const oyente of [...oyentes[tipo]]) oyente()
  }
  const hashActual = (): string => entradas[indice].hash
  const recorrer = (delta: number): void => {
    const destino = indice + delta // se fija ahora, no al aterrizar
    if (opciones.sinAterrizar) return
    queueMicrotask(() => {
      if (destino < 0 || destino >= entradas.length) return
      const antes = hashActual()
      indice = destino
      emitir('popstate')
      if (hashActual() !== antes) queueMicrotask(() => emitir('hashchange'))
    })
  }
  const ventana = {
    location: {
      get hash() {
        return hashActual()
      },
      set hash(valor: string) {
        if (valor === hashActual()) return
        operaciones.push(`empujar ${valor}`)
        entradas.splice(indice + 1, entradas.length, { hash: valor, state: null })
        indice++
        emitir('popstate')
        queueMicrotask(() => emitir('hashchange'))
      },
      replace(url: string) {
        operaciones.push(`reemplazar ${url}`)
        const cambia = url !== hashActual()
        entradas[indice] = { hash: url, state: null }
        emitir('popstate')
        if (cambia) queueMicrotask(() => emitir('hashchange'))
      },
    },
    history: {
      get state() {
        return entradas[indice].state
      },
      pushState(data: unknown) {
        operaciones.push('pushState')
        if (opciones.pushStateLanza) throw new DOMException('Attempt to use history.pushState() more than 100 times per 30 seconds', 'SecurityError')
        entradas.splice(indice + 1, entradas.length, { hash: hashActual(), state: data })
        indice++
      },
      replaceState(data: unknown) {
        operaciones.push('marcar')
        entradas[indice].state = data
      },
      back() {
        operaciones.push('atras')
        recorrer(-1)
      },
      go(delta: number) {
        operaciones.push(`ir ${delta}`)
        recorrer(delta)
      },
    },
    addEventListener: (tipo: 'popstate' | 'hashchange', oyente: () => void): void => {
      oyentes[tipo].add(oyente)
    },
    removeEventListener: (tipo: 'popstate' | 'hashchange', oyente: () => void): void => {
      oyentes[tipo].delete(oyente)
    },
    setTimeout: (fn: () => void, ms: number): number => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number): void => clearTimeout(id as unknown as NodeJS.Timeout),
  }
  return {
    ventana,
    /** El estado (la marca del router, y la de la hoja) de cada entrada, también las de adelante. */
    estados: (): unknown[] => entradas.map((e) => e.state),
    actual: hashActual,
    /** Cuántas entradas hay por debajo de la actual. */
    indice: (): number => indice,
    operaciones: (): string[] => operaciones,
    oyentes: (tipo: 'popstate' | 'hashchange'): number => oyentes[tipo].size,
  }
}

const hoja = (nivel: number, pagina = 'p1') => ({ hoja: { nivel, pagina } })

/** Un historial con Facturas y, encima, Clientes: una pantalla a profundidad 1 (`{ fx: 1, bajo: '#/facturas' }`), como la deja el router. */
function pantallaAProfundidadUno() {
  const w = ventanaFalsa([{ hash: '#/facturas', state: null }])
  const nav = crearNavegador(w.ventana)
  nav.navegar({ id: 'clientes' })
  assert.deepEqual(w.estados(), [null, { fx: 1, bajo: '#/facturas' }])
  return { w, nav, gestor: crearGestorDeCapas(w.ventana, 'p1'), marcaDeLaPantalla: { fx: 1, bajo: '#/facturas' } }
}

test('abrir y cerrar una hoja sobre una pantalla a profundidad 1 no cambia su fx ni su bajo, ni mientras está abierta ni después', async () => {
  const { w, nav, gestor, marcaDeLaPantalla } = pantallaAProfundidadUno()
  const antes = w.operaciones().length
  let cerrada = 0
  const capa = gestor.abrir(() => {
    cerrada++
  })

  // Abierta: una entrada nueva con la misma URL, la marca del router tal cual (fx y bajo) y la de la hoja encima.
  assert.deepEqual(w.estados(), [null, marcaDeLaPantalla, { ...marcaDeLaPantalla, ...hoja(1) }])
  assert.equal(w.actual(), '#/clientes')
  assert.equal(nav.hayHistorial(), true) // el router sigue viendo la profundidad: atrás sigue siendo retroceder y no reemplazar

  capa.cerrar()
  await esperar()
  assert.equal(w.indice(), 1) // de vuelta en la pantalla
  assert.deepEqual(w.estados()[1], marcaDeLaPantalla) // su entrada no se tocó
  assert.equal(nav.hayHistorial(), true)
  assert.equal(cerrada, 0) // cerrar por código no se avisa a sí misma
  // Solo la API de historial de la hoja: nada de `marcar` (replaceState), ni `navegar` (empujar o reemplazar un hash), y retrocede una vez.
  assert.deepEqual(w.operaciones().slice(antes), ['pushState', 'atras'])

  // Y el router sigue funcionando como antes de abrir la hoja: atrás vuelve a Facturas.
  nav.atras({ id: 'facturas' })
  await esperar()
  assert.equal(w.actual(), '#/facturas')
})

test('sobre una pantalla sin marca (profundidad 0) la entrada de la hoja lleva solo su marca', () => {
  const w = ventanaFalsa([{ hash: '#/facturas', state: null }])
  crearGestorDeCapas(w.ventana, 'p1').abrir(() => {})
  assert.deepEqual(w.estados(), [null, hoja(1)])
  const otra = ventanaFalsa([{ hash: '#/facturas', state: 'texto de otro código' }])
  crearGestorDeCapas(otra.ventana, 'p1').abrir(() => {}) // un estado que no es un objeto no se esparce (daría un objeto con sus letras)
  assert.deepEqual(otra.estados()[1], hoja(1))
})

test('un atrás del sistema cierra la hoja una vez y avisa a su dueño; la limpieza que llega después no vuelve a retroceder', async () => {
  const { w, gestor, marcaDeLaPantalla } = pantallaAProfundidadUno()
  let cerrada = 0
  const capa = gestor.abrir(() => {
    cerrada++
  })
  w.ventana.history.back() // el botón atrás de Android, sin pasar por la hoja
  await esperar()
  assert.equal(cerrada, 1)
  assert.equal(w.indice(), 1)
  assert.deepEqual(w.estados()[1], marcaDeLaPantalla)

  capa.cerrar() // el efecto del componente se limpia cuando el dueño pone `abierto` en false
  capa.cerrar()
  await esperar()
  assert.equal(w.indice(), 1) // no retrocedió otra vez: sacaría la pantalla
  assert.equal(w.operaciones().filter((o) => o === 'atras').length, 1) // la única es la del sistema
  assert.equal(cerrada, 1)
})

test('hojas una sobre otra: un atrás cierra solo la de arriba, y el siguiente la de abajo', async () => {
  const { w, gestor } = pantallaAProfundidadUno()
  const cerradas: string[] = []
  const a = gestor.abrir(() => cerradas.push('a'))
  const b = gestor.abrir(() => cerradas.push('b'))
  assert.deepEqual(w.estados().slice(2), [{ fx: 1, bajo: '#/facturas', ...hoja(1) }, { fx: 1, bajo: '#/facturas', ...hoja(2) }])

  w.ventana.history.back()
  await esperar()
  assert.deepEqual(cerradas, ['b']) // el popstate dejó puesta la marca de la hoja de abajo: esa no se cierra
  assert.equal(w.indice(), 2)

  w.ventana.history.back()
  await esperar()
  assert.deepEqual(cerradas, ['b', 'a'])
  assert.equal(w.indice(), 1)

  a.cerrar()
  b.cerrar()
  await esperar()
  assert.equal(w.indice(), 1) // las limpiezas posteriores no retroceden
})

test('cerrar la de abajo cierra también las de arriba, les avisa, y saca las dos entradas de un golpe', async () => {
  const { w, gestor } = pantallaAProfundidadUno()
  const cerradas: string[] = []
  const a = gestor.abrir(() => cerradas.push('a'))
  const b = gestor.abrir(() => cerradas.push('b'))
  const antes = w.operaciones().length

  a.cerrar() // la hoja de abajo se va con la de arriba dentro (el dueño las desmonta juntas)
  assert.deepEqual(cerradas, ['b'])
  await esperar()
  assert.equal(w.indice(), 1)
  assert.deepEqual(w.operaciones().slice(antes), ['ir -2'])

  b.cerrar() // su limpieza llega después: ya no está
  await esperar()
  assert.equal(w.indice(), 1)
  assert.deepEqual(cerradas, ['b']) // y a la de abajo no se le avisa de lo que ella misma pidió
})

test('dos hojas que se cierran en el mismo turno con la de arriba primero sacan cada una su entrada', async () => {
  const { w, gestor } = pantallaAProfundidadUno()
  const a = gestor.abrir(() => {})
  const b = gestor.abrir(() => {})
  const antes = w.operaciones().length
  b.cerrar()
  a.cerrar() // el atrás de la de arriba todavía no aterrizó: la de abajo tiene que sacar la suya igual
  await esperar()
  assert.equal(w.indice(), 1)
  assert.deepEqual(w.operaciones().slice(antes), ['atras', 'atras'])
})

test('una hoja que se cierra y otra que se abre en el mismo turno (de una confirmación a la siguiente): la nueva sigue abierta y queda una sola entrada', async () => {
  const { w, gestor, marcaDeLaPantalla } = pantallaAProfundidadUno()
  const cerradas: string[] = []
  const primera = gestor.abrir(() => cerradas.push('primera'))
  primera.cerrar() // pide el atrás...
  const segunda = gestor.abrir(() => cerradas.push('segunda')) // ...y la segunda espera a que aterrice para empujar su entrada
  await esperar()

  // Con un `pushState` en medio, el atrás de la primera caería por debajo de la entrada de la segunda y la dejaría sin ella (Chromium lo hace así): la
  // segunda se cerraría sola nada más abrirse.
  assert.deepEqual(cerradas, [])
  assert.equal(w.indice(), 2)
  assert.deepEqual(w.estados()[2], { ...marcaDeLaPantalla, ...hoja(1) })

  segunda.cerrar()
  await esperar()
  assert.equal(w.indice(), 1)
  assert.deepEqual(cerradas, [])
})

test('abrir, cerrar y abrir en el mismo turno, que es lo que hace StrictMode al montar una hoja: queda abierta, con una sola entrada, y un atrás la cierra una vez', async () => {
  const { w, gestor, marcaDeLaPantalla } = pantallaAProfundidadUno()
  const cerradas: string[] = []
  gestor.abrir(() => cerradas.push('1')).cerrar()
  gestor.abrir(() => cerradas.push('2'))
  await esperar()
  assert.deepEqual(cerradas, [])
  assert.equal(w.indice(), 2)
  assert.deepEqual(w.estados()[2], { ...marcaDeLaPantalla, ...hoja(1) })
  assert.equal(w.oyentes('popstate'), 1)

  w.ventana.history.back()
  await esperar()
  assert.deepEqual(cerradas, ['2'])
  assert.equal(w.indice(), 1)
  assert.deepEqual(w.estados()[1], marcaDeLaPantalla)
})

test('una hoja que se abre con un atrás en vuelo no empuja hasta que aterriza', async () => {
  const { w, gestor } = pantallaAProfundidadUno()
  const antes = w.operaciones().length
  gestor.abrir(() => {}).cerrar() // empuja, y pide el atrás
  assert.deepEqual(w.operaciones().slice(antes), ['pushState', 'atras'])
  gestor.abrir(() => {})
  assert.deepEqual(w.operaciones().slice(antes), ['pushState', 'atras']) // todavía no: el atrás no aterrizó
  await esperar()
  assert.deepEqual(w.operaciones().slice(antes), ['pushState', 'atras', 'pushState'])
})

test('una hoja que se cierra antes de que le toque empujar no empuja nada', async () => {
  const { w, gestor } = pantallaAProfundidadUno()
  gestor.abrir(() => {}).cerrar()
  const antes = w.operaciones().length
  gestor.abrir(() => {}).cerrar() // espera su turno y se cierra mientras tanto
  await esperar()
  assert.deepEqual(w.operaciones().slice(antes), []) // ni empujó ni retrocedió
  assert.equal(w.indice(), 1)
  assert.equal(w.oyentes('popstate'), 0)
})

test('si un atrás pedido nunca aterriza, lo que esperaba sigue pasado el tiempo de espera', async () => {
  const w = ventanaFalsa([{ hash: '#/facturas', state: null }], { sinAterrizar: true })
  const gestor = crearGestorDeCapas(w.ventana, 'p1', 20)
  gestor.abrir(() => {}).cerrar()
  gestor.abrir(() => {})
  const empujes = (): number => w.operaciones().filter((o) => o === 'pushState').length
  assert.equal(empujes(), 1) // la segunda espera...
  await esperar(80)
  assert.equal(empujes(), 2) // ...y no se queda esperando para siempre
  assert.equal(w.oyentes('popstate'), 1) // y como tiene su entrada, escucha
})

test('un navegar con la hoja abierta no la cierra: la hoja se desprende, y su cierre posterior no retrocede (sacaría la pantalla nueva)', async () => {
  const { w, nav, gestor } = pantallaAProfundidadUno()
  let cerrada = 0
  const capa = gestor.abrir(() => {
    cerrada++
  })
  nav.navegar({ id: 'productos' }) // `popstate` con estado null, en el acto
  assert.equal(cerrada, 0) // no es el atrás de la hoja: la ruta cambió
  assert.equal(w.actual(), '#/productos')
  assert.equal(w.oyentes('popstate'), 0) // sin hojas con entrada no hay oyente

  const antes = w.operaciones().length
  capa.cerrar()
  await esperar()
  assert.equal(w.actual(), '#/productos')
  assert.deepEqual(w.operaciones().slice(antes), []) // ni un atrás
  assert.equal(cerrada, 0)
})

test('un navegar con reemplazo sobre la entrada de la hoja la deja sin entrada: no se cierra sola y su cierre no toca el historial', async () => {
  const { w, nav, gestor } = pantallaAProfundidadUno()
  let cerrada = 0
  const capa = gestor.abrir(() => {
    cerrada++
  })
  nav.navegar({ id: 'productos' }, { reemplazar: true })
  assert.equal(cerrada, 0)
  assert.equal(w.actual(), '#/productos')
  const antes = w.operaciones().length
  capa.cerrar()
  await esperar()
  assert.deepEqual(w.operaciones().slice(antes), [])
  assert.equal(w.actual(), '#/productos')
})

test('una hoja nueva tras un navegar cuenta desde 1 (la desprendida ya no está en el historial) y su atrás sí la cierra', async () => {
  const { w, nav, gestor } = pantallaAProfundidadUno()
  gestor.abrir(() => {})
  nav.navegar({ id: 'productos' })
  let cerrada = 0
  gestor.abrir(() => {
    cerrada++
  })
  assert.deepEqual((w.estados()[w.indice()] as { hoja: unknown }).hoja, { nivel: 1, pagina: 'p1' })
  w.ventana.history.back()
  await esperar()
  assert.equal(cerrada, 1)
  assert.equal(w.actual(), '#/productos')
})

test('tras una recarga, la marca vieja de una hoja que ya no existe no se confunde con la de la hoja nueva', async () => {
  // La página se recargó con una hoja abierta: la entrada actual conserva su marca (el estado sobrevive a la recarga) pero ninguna hoja la reclama.
  const w = ventanaFalsa([
    { hash: '#/facturas', state: null },
    { hash: '#/facturas', state: { ...hoja(1, 'carga-anterior') } },
  ])
  let cerrada = 0
  crearGestorDeCapas(w.ventana, 'carga-nueva').abrir(() => {
    cerrada++
  })
  assert.equal(w.indice(), 2)
  w.ventana.history.back() // cae en la entrada vieja: nivel 1 pero de otra carga
  await esperar()
  assert.equal(cerrada, 1) // la hoja nueva sí se cierra al primer atrás (con la marca vieja valiendo 1 haría falta un segundo)
})

test('el oyente de popstate solo está puesto mientras haga falta: con hojas con entrada o con un atrás en vuelo', async () => {
  const { w, gestor } = pantallaAProfundidadUno()
  assert.equal(w.oyentes('popstate'), 0)
  const a = gestor.abrir(() => {})
  const b = gestor.abrir(() => {})
  assert.equal(w.oyentes('popstate'), 1) // uno solo para las dos
  b.cerrar()
  assert.equal(w.oyentes('popstate'), 1)
  a.cerrar()
  assert.equal(w.oyentes('popstate'), 1) // el atrás de la última sigue en vuelo, y su popstate es lo que libera a lo que espere detrás
  await esperar()
  assert.equal(w.oyentes('popstate'), 0)
})

test('con un atrás en vuelo y nada más esperando, el oyente sigue puesto hasta que aterriza: la hoja que se abre después empuja en el acto, sin esperar al respaldo', async () => {
  const { w, gestor } = pantallaAProfundidadUno()
  gestor.abrir(() => {}).cerrar()
  assert.equal(w.oyentes('popstate'), 1) // sin cola y sin hojas con entrada: solo el atrás en vuelo lo mantiene
  await esperar() // aterriza
  assert.equal(w.oyentes('popstate'), 0)

  const antes = w.operaciones().length
  gestor.abrir(() => {})
  assert.deepEqual(w.operaciones().slice(antes), ['pushState']) // ya no hay nada en vuelo: ni espera ni cola
  // Si el aterrizaje no se hubiera oído, el gestor seguiría creyendo que el atrás está en vuelo y esta hoja esperaría el respaldo de 500 ms.
})

test('si pushState lanza (Safari corta la API pasadas 100 llamadas en 30 s) la hoja abre igual, sin entrada, y cerrarla no toca el historial', async () => {
  const w = ventanaFalsa([{ hash: '#/facturas', state: null }], { pushStateLanza: true })
  const capa = crearGestorDeCapas(w.ventana, 'p1').abrir(() => {})
  assert.equal(w.oyentes('popstate'), 0)
  capa.cerrar()
  await esperar()
  assert.deepEqual(w.operaciones(), ['pushState']) // el intento, y nada más
  assert.equal(w.indice(), 0)
})

test('si la entrada actual ya no lleva la marca de una hoja (alguien cambió el estado sin que el gestor se enterara), cerrar no retrocede', async () => {
  const { w, gestor } = pantallaAProfundidadUno()
  const capa = gestor.abrir(() => {})
  w.ventana.history.replaceState({ fx: 1, bajo: '#/facturas' }) // un `marcar` perdido sobre la entrada de la hoja
  const antes = w.operaciones().length
  capa.cerrar()
  await esperar()
  assert.deepEqual(w.operaciones().slice(antes), []) // retroceder sacaría la pantalla de debajo
  assert.equal(w.indice(), 2)
})

test('cerrar dos veces la misma hoja retrocede una sola vez', async () => {
  const { w, gestor } = pantallaAProfundidadUno()
  const capa = gestor.abrir(() => {})
  capa.cerrar()
  capa.cerrar()
  await esperar()
  assert.equal(w.operaciones().filter((o) => o === 'atras').length, 1)
  assert.equal(w.indice(), 1)
})

test('cierraPorArrastre: un arrastre de 80 px hacia abajo cierra y uno menor no', () => {
  assert.equal(UMBRAL_ARRASTRE_PX, 80)
  assert.equal(cierraPorArrastre(79), false)
  assert.equal(cierraPorArrastre(80), true)
  assert.equal(cierraPorArrastre(300), true)
  assert.equal(cierraPorArrastre(0), false)
  assert.equal(cierraPorArrastre(-120), false) // hacia arriba nunca cierra
})

// --- Una acción de hoja que navega (cuandoAterriceElAtras) ---------------------------------------------------------------------------
// La regla del plan 06 para la primera hoja sin `historialDeRuta` cuya acción navega («Ver factura» en la hoja de cerrar sesión, que se abre sobre Más): se
// cierra la hoja primero y se navega cuando el atrás de su cierre ya aterrizó, nunca con la entrada de la hoja puesta. Aquí corren el router real y el gestor real,
// sobre la misma ventana falsa, y se mira qué quedó en el historial (la marca `{ fx, bajo }` de cada entrada) y adónde lleva un atrás.

/** Facturas, Clientes (profundidad 1), Más encima de Clientes (la ruta es dueña de esa entrada: profundidad 2) y sobre Más la hoja de confirmación, con su entrada. */
async function masConUnaHojaAbierta() {
  const w = ventanaFalsa([{ hash: '#/facturas', state: null }])
  const nav = crearNavegador(w.ventana)
  const gestor = crearGestorDeCapas(w.ventana, 'p1')
  nav.navegar({ id: 'clientes' })
  nav.navegar({ id: 'mas' })
  const capa = gestor.abrir(() => {})
  await esperar()
  return { w, nav, capa }
}

const MARCA_DE_MAS = { fx: 2, bajo: '#/clientes' }

test('Ver factura sobre Más: la hoja se cierra, el atrás aterriza y entonces se reemplaza la entrada de Más; fx y bajo quedan como en un toque de fila y un atrás cae en el origen', async () => {
  const { w, nav, capa } = await masConUnaHojaAbierta()
  assert.deepEqual(w.estados(), [null, { fx: 1, bajo: '#/facturas' }, MARCA_DE_MAS, { ...MARCA_DE_MAS, ...hoja(1) }])
  const antes = w.operaciones().length

  cuandoAterriceElAtras(() => nav.navegar({ id: 'factura', facturaId: 12 }, { reemplazar: true }), w.ventana)
  capa.cerrar()
  assert.equal(w.actual(), '#/mas') // el atrás todavía no aterrizó: no se navegó con la entrada de la hoja puesta
  assert.deepEqual(w.operaciones().slice(antes), ['atras'])

  await esperar()
  assert.deepEqual(w.operaciones().slice(antes), ['atras', 'reemplazar #/facturas/12', 'marcar']) // el atrás primero; después el reemplazo y la marca copiada
  assert.equal(w.actual(), '#/facturas/12')
  assert.equal(w.indice(), 2) // en el lugar de Más, no encima
  assert.deepEqual(w.estados().slice(0, 3), [null, { fx: 1, bajo: '#/facturas' }, MARCA_DE_MAS]) // la entrada de Más ahora es la factura y conserva su marca
  assert.equal(nav.hayHistorial(), true)

  nav.atras({ id: 'facturas' })
  await esperar()
  assert.equal(w.actual(), '#/clientes') // un solo atrás vuelve al origen: ni Más ni la hoja quedaron enterradas
})

test('lo mismo sobre una pantalla sin historial debajo: la entrada de la ruta no tiene marca y el reemplazo no la inventa', async () => {
  const w = ventanaFalsa([{ hash: '#/mas', state: null }]) // Más abierto con un enlace directo: fx 0
  const nav = crearNavegador(w.ventana)
  const capa = crearGestorDeCapas(w.ventana, 'p1').abrir(() => {})
  await esperar()
  const antes = w.operaciones().length

  cuandoAterriceElAtras(() => nav.navegar({ id: 'factura', facturaId: 12 }, { reemplazar: true }), w.ventana)
  capa.cerrar()
  await esperar()
  assert.deepEqual(w.operaciones().slice(antes), ['atras', 'reemplazar #/facturas/12']) // a profundidad 0 no hay marca que copiar
  assert.equal(w.actual(), '#/facturas/12')
  assert.equal(w.indice(), 0)
  assert.deepEqual(w.estados()[0], null)
})

test('si el atrás nunca aterriza, luego corre igual pasado el tiempo de espera, y deja de escuchar', async () => {
  const w = ventanaFalsa([{ hash: '#/facturas', state: null }], { sinAterrizar: true })
  let corridas = 0
  cuandoAterriceElAtras(
    () => {
      corridas++
    },
    w.ventana,
    20,
  )
  assert.equal(w.oyentes('popstate'), 1)
  assert.equal(corridas, 0)
  await esperar(80)
  assert.equal(corridas, 1)
  assert.equal(w.oyentes('popstate'), 0)
})

test('corre una sola vez: otros popstate seguidos, y el que lanza lo que ella navega, no la repiten ni dejan el oyente puesto', async () => {
  const w = ventanaFalsa([
    { hash: '#/facturas', state: null },
    { hash: '#/clientes', state: null },
    { hash: '#/productos', state: null },
  ])
  let corridas = 0
  cuandoAterriceElAtras(
    () => {
      corridas++
      w.ventana.location.replace('#/otra') // navegar lanza `popstate` en el acto
    },
    w.ventana,
    5_000, // si no limpiara su temporizador, esta prueba tardaría 5 s en terminar
  )
  w.ventana.history.back()
  w.ventana.history.back()
  await esperar()
  assert.equal(corridas, 1)
  assert.equal(w.oyentes('popstate'), 0)
})
