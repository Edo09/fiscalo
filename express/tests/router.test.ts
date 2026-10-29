// El router de hash (anexo 5.4). parseHash, formatHash, moduloDeRuta y las acciones de historial (accionTab, accionHoja) son funciones puras;
// navegar, atras e irATab tocan la ventana, así que se prueban con `crearNavegador` sobre una ventana falsa que lleva el historial del navegador
// (`ventanaFalsa`, más abajo).
import assert from 'node:assert/strict'
import test from 'node:test'
import { accionHoja, accionTab, crearNavegador, formatHash, moduloDeRuta, parseHash } from '~/router'
import type { Ruta, VentanaDeRutas } from '~/router'
import { esperar } from './ayudas'

const CASOS: [string, Ruta][] = [
  ['', { id: 'facturas' }],
  ['#/facturas?q=abc&estado=accion&tipo=45', { id: 'facturas', q: 'abc', estado: 'accion', tipo: '45' }],
  ['#/facturas/12', { id: 'factura', facturaId: 12 }],
  ['#/facturas/12/anular', { id: 'anular', facturaId: 12 }],
  ['#/facturar', { id: 'facturar' }],
  ['#/facturar/productos', { id: 'facturar-productos' }],
  ['#/facturar/revisar', { id: 'facturar-revisar' }],
  ['#/facturar/resultado/0b8f2a5e-6c1d-4f7a-9c3e-1d2b3a4c5d6e', { id: 'facturar-resultado', clave: '0b8f2a5e-6c1d-4f7a-9c3e-1d2b3a4c5d6e' }],
  ['#/clientes', { id: 'clientes' }],
  ['#/clientes/nuevo', { id: 'cliente-nuevo' }],
  ['#/clientes/7', { id: 'cliente', clienteId: 7 }],
  ['#/productos', { id: 'productos' }],
  ['#/productos/3', { id: 'producto', productoId: 3 }],
  ['#/mas', { id: 'mas' }],
  ['#/mas/empresa', { id: 'mas-empresa' }],
  ['#/mas/numeracion', { id: 'mas-numeracion' }],
  ['#/mas/usuarios', { id: 'mas-usuarios' }],
  ['#/nada', { id: 'facturas' }],
  ['#/facturas/abc', { id: 'facturas' }],
  ['#/facturas/0', { id: 'facturas' }],
  ['#/facturas/-3', { id: 'facturas' }],
  ['#/facturas?estado=zzz&tipo=4', { id: 'facturas' }],
]

test('parseHash', () => {
  for (const [h, r] of CASOS) assert.deepEqual(parseHash(h), r, h)
})

test('formatHash ida y vuelta', () => {
  // Las 16 rutas con hash propio son CASOS[1] a CASOS[16]. CASOS[0] es el inicio sin hash (''), que se escribe #/facturas, la forma que usan la
  // barra y la guardia: por eso no entra en la ida y vuelta literal y tiene su propia aserción.
  for (const [h] of CASOS.slice(1, 17)) assert.equal(formatHash(parseHash(h)), h)
  assert.equal(formatHash(parseHash('')), '#/facturas')
  assert.equal(formatHash(parseHash('#/facturas?q=a%20%C3%B1')), '#/facturas?q=a%20%C3%B1')
  // Y escribir y volver a leer nunca cambia la ruta, tampoco la de lo que cae en Facturas.
  for (const [h] of CASOS) assert.deepEqual(parseHash(formatHash(parseHash(h))), parseHash(h), h)
})

test('formatHash: sin filtros vacíos, en el orden q, estado, tipo y con todo codificado', () => {
  assert.equal(formatHash({ id: 'facturas' }), '#/facturas')
  assert.equal(formatHash({ id: 'facturas', q: '', estado: '', tipo: '' }), '#/facturas')
  assert.equal(formatHash({ id: 'facturas', tipo: '31', estado: 'accion' }), '#/facturas?estado=accion&tipo=31')
  const q = 'a&b=c#d?e/f ñ'
  const hash = formatHash({ id: 'facturas', q })
  assert.equal(hash, '#/facturas?q=a%26b%3Dc%23d%3Fe%2Ff%20%C3%B1')
  assert.deepEqual(parseHash(hash), { id: 'facturas', q })
})

test('formatHash no lanza con un sustituto suelto (media pareja de un emoji que un teclado dejó a medias en la búsqueda)', () => {
  // encodeURIComponent lanza URIError con un sustituto suelto: aquí se cambia por U+FFFD, y el emoji entero pasa tal cual.
  for (const suelto of ['\uD83D', '\uDE00']) {
    let hash = ''
    assert.doesNotThrow(() => {
      hash = formatHash({ id: 'facturas', q: `a${suelto}b` })
    })
    assert.equal(hash, '#/facturas?q=a%EF%BF%BDb')
  }
  assert.doesNotThrow(() => formatHash({ id: 'facturar-resultado', clave: 'k\uD83D' }))
  assert.equal(formatHash({ id: 'facturas', q: 'a\u{1F600}' }), '#/facturas?q=a%F0%9F%98%80')
  assert.deepEqual(parseHash('#/facturas?q=a%F0%9F%98%80'), { id: 'facturas', q: 'a\u{1F600}' })
})

test('parseHash: el # inicial es opcional y una barra o un segmento vacío de más no cambian la ruta', () => {
  for (const h of ['#/facturas/12', '/facturas/12', '#/facturas/12/', '#//facturas//12']) assert.deepEqual(parseHash(h), { id: 'factura', facturaId: 12 }, h)
  for (const h of ['#', '#/', '/', '#/facturas/', '#/facturas?']) assert.deepEqual(parseHash(h), { id: 'facturas' }, h)
})

test('parseHash: lo que sobra o no existe cae en Facturas', () => {
  const HASHES = [
    '#/facturas/12/anular/mas',
    '#/facturas/12/otra',
    '#/facturar/resultado',
    '#/facturar/resultado/',
    '#/facturar/otra',
    '#/facturar/productos/1',
    '#/clientes/abc',
    '#/clientes/nuevo/1',
    '#/productos/nuevo',
    '#/mas/otra',
    '#/mas/empresa/1',
    '#/dev/ui',
    '#/Facturas',
    'x',
  ]
  for (const h of HASHES) assert.deepEqual(parseHash(h), { id: 'facturas' }, h)
})

test('parseHash: un id es un entero positivo en su forma canónica', () => {
  for (const id of ['abc', '0', '-3', '1.5', '007', '1e3', '12abc', '%2012', '99999999999999999999']) {
    assert.deepEqual(parseHash(`#/facturas/${id}`), { id: 'facturas' }, `facturas/${id}`)
    assert.deepEqual(parseHash(`#/facturas/${id}/anular`), { id: 'facturas' }, `facturas/${id}/anular`)
    assert.deepEqual(parseHash(`#/clientes/${id}`), { id: 'facturas' }, `clientes/${id}`)
    assert.deepEqual(parseHash(`#/productos/${id}`), { id: 'facturas' }, `productos/${id}`)
  }
  assert.deepEqual(parseHash('#/facturas/9007199254740991'), { id: 'factura', facturaId: 9007199254740991 })
})

test('parseHash: los filtros de Facturas', () => {
  // q va tal cual: sin recortar (el campo de búsqueda escribe aquí mientras se teclea y un espacio final es del usuario). Vacío no es nada.
  assert.deepEqual(parseHash('#/facturas?q=abc%20'), { id: 'facturas', q: 'abc ' })
  assert.deepEqual(parseHash('#/facturas?q=a+b'), { id: 'facturas', q: 'a b' })
  assert.deepEqual(parseHash('#/facturas?q='), { id: 'facturas' })
  // estado: solo los de los chips (Todas no lleva estado).
  for (const estado of ['pendiente', 'accion', 'aprobado']) assert.deepEqual(parseHash(`#/facturas?estado=${estado}`), { id: 'facturas', estado })
  for (const estado of ['', 'rechazado', 'Accion', 'ACCION', 'pendiente%20']) assert.deepEqual(parseHash(`#/facturas?estado=${estado}`), { id: 'facturas' }, estado)
  // tipo: el código de dos dígitos. Que el tenant lo tenga lo decide la guardia, no el router.
  for (const tipo of ['31', '33', '34', '45', '99']) assert.deepEqual(parseHash(`#/facturas?tipo=${tipo}`), { id: 'facturas', tipo }, tipo)
  for (const tipo of ['', '4', '045', 'x1', '3%201']) assert.deepEqual(parseHash(`#/facturas?tipo=${tipo}`), { id: 'facturas' }, tipo)
  // Lo inválido se descarta solo: lo válido de al lado se queda.
  assert.deepEqual(parseHash('#/facturas?estado=zzz&tipo=45&q=x'), { id: 'facturas', q: 'x', tipo: '45' })
  // Las claves que no son suyas se ignoran y de una repetida vale la primera.
  assert.deepEqual(parseHash('#/facturas?foo=1&q=a&q=b'), { id: 'facturas', q: 'a' })
  // Los filtros son solo de Facturas.
  assert.deepEqual(parseHash('#/clientes?q=abc&estado=accion&tipo=45'), { id: 'clientes' })
  assert.deepEqual(parseHash('#/facturas/12?q=abc'), { id: 'factura', facturaId: 12 })
})

test('parseHash: la clave de un resultado va codificada y un % mal formado no lanza', () => {
  assert.deepEqual(parseHash('#/facturar/resultado/a%2Fb'), { id: 'facturar-resultado', clave: 'a/b' })
  assert.equal(formatHash({ id: 'facturar-resultado', clave: 'a/b c' }), '#/facturar/resultado/a%2Fb%20c')
  assert.doesNotThrow(() => parseHash('#/facturar/resultado/%E0%A4%A'))
  assert.deepEqual(parseHash('#/facturar/resultado/%E0%A4%A'), { id: 'facturas' })
})

test('parseHash entrega una ruta nueva cada vez: quien la reciba puede cambiarla', () => {
  const a = parseHash('#/nada')
  const b = parseHash('#/nada')
  assert.notEqual(a, b)
  assert.deepEqual(a, b)
})

test('moduloDeRuta', () => {
  assert.deepEqual(moduloDeRuta({ id: 'mas-usuarios' }), { modulo: 'usuarios', admin: true })
  assert.deepEqual(moduloDeRuta({ id: 'mas' }), { modulo: null, admin: false })
  assert.equal(moduloDeRuta({ id: 'facturar-revisar' }).modulo, 'facturacion')
  assert.equal(moduloDeRuta({ id: 'mas-numeracion' }).modulo, 'configuracion')
})

test('moduloDeRuta: el módulo de cada una de las 16 rutas (anexo 5.4)', () => {
  const TABLA: [Ruta, string | null, boolean][] = [
    [{ id: 'facturas' }, 'facturacion', false],
    [{ id: 'factura', facturaId: 1 }, 'facturacion', false],
    [{ id: 'anular', facturaId: 1 }, 'facturacion', false],
    [{ id: 'facturar' }, 'facturacion', false],
    [{ id: 'facturar-productos' }, 'facturacion', false],
    [{ id: 'facturar-revisar' }, 'facturacion', false],
    [{ id: 'facturar-resultado', clave: 'k' }, 'facturacion', false],
    [{ id: 'clientes' }, 'clientes', false],
    [{ id: 'cliente-nuevo' }, 'clientes', false],
    [{ id: 'cliente', clienteId: 1 }, 'clientes', false],
    [{ id: 'productos' }, 'productos', false],
    [{ id: 'producto', productoId: 1 }, 'productos', false],
    [{ id: 'mas' }, null, false],
    [{ id: 'mas-empresa' }, 'configuracion', false],
    [{ id: 'mas-numeracion' }, 'configuracion', false],
    [{ id: 'mas-usuarios' }, 'usuarios', true],
  ]
  assert.equal(new Set(TABLA.map(([r]) => r.id)).size, 16)
  for (const [ruta, modulo, admin] of TABLA) assert.deepEqual(moduloDeRuta(ruta), { modulo, admin }, ruta.id)
})

test('accionTab', () => {
  assert.equal(accionTab({ id: 'facturas' }, { id: 'clientes' }, true), 'push')
  assert.equal(accionTab({ id: 'clientes' }, { id: 'productos' }, true), 'replace')
  assert.equal(accionTab({ id: 'clientes' }, { id: 'facturas' }, true), 'back')
  assert.equal(accionTab({ id: 'clientes' }, { id: 'facturas' }, false), 'replace')
})

test('accionTab: el historial de las pestañas es el inicio más, a lo sumo, una entrada', () => {
  // Del inicio a otra pestaña se empuja, haya o no historial: es la única entrada que se agrega.
  assert.equal(accionTab({ id: 'facturas', q: 'abc' }, { id: 'productos' }, false), 'push')
  // Entre las demás se reemplaza, así atrás sigue llevando al inicio.
  assert.equal(accionTab({ id: 'productos' }, { id: 'clientes' }, true), 'replace')
  assert.equal(accionTab({ id: 'clientes' }, { id: 'clientes' }, true), 'replace')
  // Volver al inicio es atrás, y sin historial (enlace directo) se reemplaza: así no se sale de la app.
  assert.equal(accionTab({ id: 'productos' }, { id: 'facturas' }, true), 'back')
  assert.equal(accionTab({ id: 'productos' }, { id: 'facturas' }, false), 'replace')
  // Tocar la pestaña en que ya se está no agrega entradas (la barra se encarga de subir y limpiar la búsqueda).
  assert.equal(accionTab({ id: 'facturas' }, { id: 'facturas' }, true), 'replace')
  assert.equal(accionTab({ id: 'facturas', q: 'abc' }, { id: 'facturas' }, false), 'replace')
  // Desde un detalle, otra pestaña lo reemplaza (el detalle no queda debajo) y la de Facturas vuelve a la lista.
  assert.equal(accionTab({ id: 'factura', facturaId: 3 }, { id: 'clientes' }, true), 'replace')
  assert.equal(accionTab({ id: 'factura', facturaId: 3 }, { id: 'facturas' }, true), 'back')
  assert.equal(accionTab({ id: 'factura', facturaId: 3 }, { id: 'facturas' }, false), 'replace')
  // El asistente no es una pestaña: se entra empujando desde cualquier parte, y atrás vuelve de donde se vino.
  assert.equal(accionTab({ id: 'facturas' }, { id: 'facturar' }, false), 'push')
  assert.equal(accionTab({ id: 'clientes' }, { id: 'facturar' }, true), 'push')
})

test('hoja de Mas: abrir, tocar una fila y volver deja el origen', () => {
  // anexo 5.2
  const pila = ['#/clientes']
  const aplicar = (a: 'push' | 'replace' | 'back', hash: string) => {
    if (a === 'push') pila.push(hash)
    else if (a === 'replace') pila[pila.length - 1] = hash
    else pila.pop()
  }
  aplicar(accionHoja('abrir', true), '#/mas')
  aplicar(accionHoja('fila', true), '#/mas/empresa')
  aplicar(accionHoja('volver', true), '')
  assert.deepEqual(pila, ['#/clientes'])
  assert.equal(accionHoja('volver', false), 'replace')
})

test('accionHoja: abrir empuja, la fila reemplaza y volver depende de si hay historial', () => {
  assert.equal(accionHoja('abrir', false), 'push')
  assert.equal(accionHoja('abrir', true), 'push')
  assert.equal(accionHoja('fila', false), 'replace')
  assert.equal(accionHoja('fila', true), 'replace')
  assert.equal(accionHoja('volver', true), 'back')
  assert.equal(accionHoja('volver', false), 'replace')
})

// --- navegar, atras e irATab sobre una ventana falsa ------------------------------------------------------------------------------

interface Entrada {
  hash: string
  state: unknown
}

/**
 * Una ventana falsa con el historial del navegador, lo justo para el router. Como en el navegador: asignar `location.hash` empuja una entrada nueva
 * con estado null (y borra las de adelante), `location.replace` reemplaza la actual con estado null, `history.replaceState` solo cambia el estado de
 * la actual, `history.back()` retrocede una entrada (después, en un microtask) y `hashchange` llega también en un microtask, solo si el hash de la
 * entrada actual cambió. Asignar el hash que ya hay no hace nada. Una recarga conserva las entradas y su estado: se prueba con otro `crearNavegador`
 * sobre la misma ventana.
 * @param entradas el historial de partida; la actual es la última
 * @param opciones `replaceStateLanza`: `history.replaceState` lanza SecurityError, como Safari al pasar de 100 llamadas en 30 segundos
 */
function ventanaFalsa(entradas: Entrada[], opciones: { replaceStateLanza?: boolean } = {}) {
  let indice = entradas.length - 1
  let salio = false
  const oyentes = new Set<() => void>()
  const operaciones: string[] = []
  const hashActual = (): string => entradas[indice].hash
  const avisarSiCambio = (antes: string): void => {
    if (hashActual() === antes) return
    queueMicrotask(() => {
      for (const oyente of [...oyentes]) oyente()
    })
  }
  const ventana: VentanaDeRutas = {
    location: {
      get hash() {
        return hashActual()
      },
      set hash(valor: string) {
        const antes = hashActual()
        if (valor === antes) return
        operaciones.push(`empujar ${valor}`)
        entradas.splice(indice + 1, entradas.length, { hash: valor, state: null })
        indice++
        avisarSiCambio(antes)
      },
      replace(url: string) {
        const antes = hashActual()
        operaciones.push(`reemplazar ${url}`)
        entradas[indice] = { hash: url, state: null }
        avisarSiCambio(antes)
      },
    },
    history: {
      get state() {
        return entradas[indice].state
      },
      back() {
        operaciones.push('atras')
        queueMicrotask(() => {
          if (indice === 0) {
            salio = true // atrás desde la primera entrada saca al usuario de la app
            return
          }
          const antes = hashActual()
          indice--
          avisarSiCambio(antes)
        })
      },
      replaceState(data: unknown) {
        operaciones.push('marcar')
        if (opciones.replaceStateLanza) throw new DOMException('Attempt to use history.replaceState() more than 100 times per 30 seconds', 'SecurityError')
        entradas[indice].state = data
      },
    },
    addEventListener: (_tipo, oyente) => {
      oyentes.add(oyente)
    },
    removeEventListener: (_tipo, oyente) => {
      oyentes.delete(oyente)
    },
  }
  return {
    ventana,
    /** Todas las entradas, también las de adelante. */
    pila: (): string[] => entradas.map((e) => e.hash),
    /** El hash de la entrada actual. */
    actual: hashActual,
    /** Cuántas entradas hay por debajo de la actual. */
    indice: (): number => indice,
    operaciones: (): string[] => operaciones,
    oyentes: (): number => oyentes.size,
    salio: (): boolean => salio,
  }
}

/** Una ventana que arranca en `hash`, como una pestaña que se abrió ahí (sin marca de la app). */
const abrirEn = (hash: string, opciones?: { replaceStateLanza?: boolean }) => ventanaFalsa([{ hash, state: null }], opciones)

test('navegar empuja una entrada y avisa una vez a quien escucha; hayHistorial pasa a ser cierto', async () => {
  const w = abrirEn('#/facturas')
  const nav = crearNavegador(w.ventana)
  let avisos = 0
  nav.suscribir(() => {
    avisos++
  })
  assert.equal(nav.hayHistorial(), false)

  nav.navegar({ id: 'clientes' })
  await esperar()
  assert.deepEqual(w.pila(), ['#/facturas', '#/clientes'])
  assert.equal(nav.hashActual(), '#/clientes')
  assert.equal(nav.hayHistorial(), true)
  assert.equal(avisos, 1)

  nav.navegar({ id: 'cliente', clienteId: 7 })
  await esperar()
  assert.deepEqual(w.pila(), ['#/facturas', '#/clientes', '#/clientes/7'])
  assert.equal(avisos, 2)
})

test('navegar a la ruta en que ya se está no empuja nada, aunque el hash se escriba distinto', async () => {
  const igual = abrirEn('#/clientes')
  crearNavegador(igual.ventana).navegar({ id: 'clientes' })
  crearNavegador(igual.ventana).navegar({ id: 'clientes' }, { reemplazar: true })
  await esperar()
  assert.deepEqual(igual.operaciones(), [])

  // '' y #/facturas son la misma ruta: empujar una sobre la otra dejaría dos entradas iguales.
  const inicio = abrirEn('')
  crearNavegador(inicio.ventana).navegar({ id: 'facturas' })
  await esperar()
  assert.deepEqual(inicio.operaciones(), [])
  assert.deepEqual(inicio.pila(), [''])

  // Reemplazando sí se deja el hash en su forma canónica (sin entradas nuevas).
  crearNavegador(inicio.ventana).navegar({ id: 'facturas' }, { reemplazar: true })
  await esperar()
  assert.deepEqual(inicio.pila(), ['#/facturas'])
})

test('navegar con reemplazar cambia la entrada actual y conserva la profundidad', async () => {
  const w = abrirEn('#/facturas')
  const nav = crearNavegador(w.ventana)
  nav.navegar({ id: 'clientes' })
  nav.navegar({ id: 'productos' }, { reemplazar: true })
  await esperar()
  assert.deepEqual(w.pila(), ['#/facturas', '#/productos'])
  assert.equal(nav.hashActual(), '#/productos')
  assert.equal(nav.hayHistorial(), true)

  // Reemplazar en la primera entrada no inventa historial.
  const sola = abrirEn('#/facturas/12')
  const navSola = crearNavegador(sola.ventana)
  navSola.navegar({ id: 'facturas' }, { reemplazar: true })
  await esperar()
  assert.deepEqual(sola.pila(), ['#/facturas'])
  assert.equal(navSola.hayHistorial(), false)
})

test('atras: con historial de la app vuelve una entrada; sin él reemplaza por la ruta de respaldo y no sale de la app', async () => {
  const conHistorial = abrirEn('#/facturas')
  const nav = crearNavegador(conHistorial.ventana)
  nav.navegar({ id: 'factura', facturaId: 12 })
  nav.atras({ id: 'facturas' })
  await esperar()
  assert.equal(conHistorial.actual(), '#/facturas')
  assert.equal(conHistorial.indice(), 0)
  assert.equal(conHistorial.salio(), false)

  // Abierta por un enlace directo (WhatsApp, recarga en otra pestaña): no hay entrada de la app debajo.
  const enlace = abrirEn('#/facturas/12')
  crearNavegador(enlace.ventana).atras({ id: 'facturas' })
  await esperar()
  assert.deepEqual(enlace.pila(), ['#/facturas'])
  assert.equal(enlace.operaciones().includes('atras'), false)
  assert.equal(enlace.salio(), false)
})

test('la profundidad vive en el historial: sobrevive a una recarga y un atrás del sistema la baja', async () => {
  const w = abrirEn('#/facturas')
  crearNavegador(w.ventana).navegar({ id: 'factura', facturaId: 12 })
  await esperar()

  // Recarga: el módulo empieza de cero sobre el mismo historial, y la entrada sigue marcada.
  const tras = crearNavegador(w.ventana)
  assert.equal(tras.hayHistorial(), true)
  tras.atras({ id: 'facturas' })
  await esperar()
  assert.equal(w.actual(), '#/facturas')

  // Un atrás del sistema (el botón de Android) también deja la cuenta al día: la entrada de abajo es la primera.
  assert.equal(tras.hayHistorial(), false)
  tras.atras({ id: 'clientes' })
  await esperar()
  assert.equal(w.salio(), false)
  assert.equal(w.actual(), '#/clientes')
})

test('si el navegador no deja marcar la entrada, navegar no lanza y atrás es conservador: nunca saca de la app', async () => {
  const w = abrirEn('#/facturas', { replaceStateLanza: true })
  const nav = crearNavegador(w.ventana)
  assert.doesNotThrow(() => nav.navegar({ id: 'clientes' }))
  await esperar()
  assert.deepEqual(w.pila(), ['#/facturas', '#/clientes'])
  assert.equal(nav.hayHistorial(), false)

  nav.atras({ id: 'facturas' })
  await esperar()
  assert.equal(w.actual(), '#/facturas')
  assert.equal(w.operaciones().includes('atras'), false)
  assert.equal(w.salio(), false)
})

test('suscribir avisa de cada cambio de hash y deja de avisar al cancelar; sin suscritos no hay oyentes en la ventana', async () => {
  const w = abrirEn('#/facturas')
  const nav = crearNavegador(w.ventana)
  assert.equal(w.oyentes(), 0)
  let avisos = 0
  const cancelar = nav.suscribir(() => {
    avisos++
  })
  assert.equal(w.oyentes(), 1)
  nav.navegar({ id: 'clientes' })
  nav.navegar({ id: 'productos' }, { reemplazar: true })
  await esperar()
  assert.equal(avisos, 2)

  cancelar()
  cancelar() // cancelar dos veces no rompe nada
  nav.navegar({ id: 'mas' })
  await esperar()
  assert.equal(avisos, 2)
  assert.equal(w.oyentes(), 0)
})

test('irATab: Facturas, Clientes, Productos y de vuelta a Facturas deja el historial como empezó', async () => {
  const w = abrirEn('#/facturas')
  const nav = crearNavegador(w.ventana)

  nav.irATab({ id: 'clientes' })
  await esperar()
  assert.deepEqual([w.actual(), w.indice()], ['#/clientes', 1])

  nav.irATab({ id: 'productos' })
  await esperar()
  assert.deepEqual([w.actual(), w.indice()], ['#/productos', 1]) // reemplazó: sigue siendo el inicio más una entrada
  assert.deepEqual(w.pila(), ['#/facturas', '#/productos'])

  nav.irATab({ id: 'facturas' })
  await esperar()
  assert.deepEqual([w.actual(), w.indice()], ['#/facturas', 0])
  assert.equal(w.salio(), false)
})

test('irATab desde un enlace directo: volver a Facturas reemplaza, no hay nada debajo a lo que volver', async () => {
  const w = abrirEn('#/clientes')
  crearNavegador(w.ventana).irATab({ id: 'facturas' })
  await esperar()
  assert.deepEqual(w.pila(), ['#/facturas'])
  assert.equal(w.operaciones().includes('atras'), false)
})

test('irATab desde un detalle: otra pestaña lo reemplaza y la de Facturas vuelve a la lista', async () => {
  const w = abrirEn('#/facturas')
  const nav = crearNavegador(w.ventana)
  nav.navegar({ id: 'factura', facturaId: 12 })
  nav.irATab({ id: 'clientes' })
  await esperar()
  assert.deepEqual(w.pila(), ['#/facturas', '#/clientes']) // el detalle no queda debajo

  nav.irATab({ id: 'facturas' })
  await esperar()
  assert.deepEqual([w.actual(), w.indice()], ['#/facturas', 0])
})

test('el asistente se entra empujando desde cualquier pestaña, y atrás vuelve a esa pestaña', async () => {
  const w = abrirEn('#/facturas')
  const nav = crearNavegador(w.ventana)
  nav.irATab({ id: 'clientes' })
  nav.irATab({ id: 'facturar' })
  await esperar()
  assert.deepEqual(w.pila(), ['#/facturas', '#/clientes', '#/facturar'])

  nav.atras({ id: 'facturas' })
  await esperar()
  assert.equal(w.actual(), '#/clientes')
})

test('hoja de Mas sobre el historial real: abrir, tocar una fila y un atrás de Android devuelven a la pestaña de origen', async () => {
  // anexo 5.2: la ruta #/mas es dueña de su entrada; una fila reemplaza esa entrada, así un solo atrás cae en la pestaña de origen.
  const w = abrirEn('#/facturas')
  const nav = crearNavegador(w.ventana)
  nav.irATab({ id: 'clientes' })
  nav.navegar({ id: 'mas' }) // accionHoja('abrir'): push
  nav.navegar({ id: 'mas-empresa' }, { reemplazar: true }) // accionHoja('fila'): replace
  await esperar()
  assert.deepEqual(w.pila(), ['#/facturas', '#/clientes', '#/mas/empresa'])

  w.ventana.history.back() // el botón atrás del sistema, sin pasar por el router
  await esperar()
  assert.equal(w.actual(), '#/clientes')
})

test('hoja de Mas sobre el historial real: cerrarla sin tocar nada con atras vuelve a la pestaña de origen', async () => {
  const w = abrirEn('#/facturas')
  const nav = crearNavegador(w.ventana)
  nav.irATab({ id: 'clientes' })
  nav.navegar({ id: 'mas' })
  nav.atras({ id: 'facturas' }) // accionHoja('volver', true): back
  await esperar()
  assert.equal(w.actual(), '#/clientes')

  // Abierta por un enlace directo a #/mas: no hay origen al que volver, así que se reemplaza por Facturas.
  const directo = abrirEn('#/mas')
  crearNavegador(directo.ventana).atras({ id: 'facturas' })
  await esperar()
  assert.deepEqual(directo.pila(), ['#/facturas'])
})
