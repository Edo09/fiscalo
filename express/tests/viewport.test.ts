// ui/viewport: el alto del teclado en pantalla (`--kb-inset`), si está abierto, y el bloqueo de scroll de las hojas. Aquí no hay DOM, así que no se montan los
// ganchos de React: se prueba lo que deciden, que son funciones sobre una ventana y un cuerpo falsos que se portan como los del navegador.
import assert from 'node:assert/strict'
import test from 'node:test'
import { calcularInset, crearBloqueoDeScroll, crearMonitorDeTeclado, scrollBloqueado, tecladoAbierto } from '~/ui/viewport'

test('calcularInset', () => {
  assert.equal(calcularInset(780, { height: 480, offsetTop: 0 }), 300)
  assert.equal(calcularInset(780, { height: 780, offsetTop: 0 }), 0)
  assert.equal(calcularInset(780, { height: 900, offsetTop: 0 }), 0)
  assert.equal(calcularInset(780, null), 0)
})

test('calcularInset resta el desplazamiento del visualViewport (iOS lo sube al enfocar un campo) y nunca baja de 0', () => {
  assert.equal(calcularInset(780, { height: 480, offsetTop: 100 }), 200)
  assert.equal(calcularInset(780, { height: 480, offsetTop: 300 }), 0)
  assert.equal(calcularInset(780, { height: 480, offsetTop: 400 }), 0)
  assert.equal(calcularInset(780, { height: 480.5, offsetTop: 0 }), 299.5)
})

test('tecladoAbierto', () => {
  assert.equal(tecladoAbierto(150), false)
  assert.equal(tecladoAbierto(151), true)
  assert.equal(tecladoAbierto(0), false)
})

// --- El monitor del teclado -----------------------------------------------------------------------------------------------------

type VentanaDeTeclado = Parameters<typeof crearMonitorDeTeclado>[0]

/**
 * Una ventana falsa con `visualViewport`. `cambiar` modifica lo que el navegador mide y emite el evento que corresponde: `resize` del visualViewport
 * (el teclado sube o baja) o `scroll` (iOS desplaza el visualViewport sin cambiar su alto). `girar` cambia el alto de la ventana (un giro de pantalla).
 * Los oyentes se guardan por evento para poder contar cuántos quedan.
 */
function pantallaFalsa(innerHeight: number, vv: { height: number; offsetTop: number; scale: number } | null) {
  const medidas = { innerHeight, vv: vv === null ? null : { ...vv } }
  const oyentes = { ventana: new Set<() => void>(), resize: new Set<() => void>(), scroll: new Set<() => void>() }
  const emitir = (conjunto: Set<() => void>): void => {
    for (const oyente of [...conjunto]) oyente()
  }
  const ventana = {
    get innerHeight() {
      return medidas.innerHeight
    },
    visualViewport:
      medidas.vv === null
        ? null
        : {
            get height() {
              return medidas.vv!.height
            },
            get offsetTop() {
              return medidas.vv!.offsetTop
            },
            get scale() {
              return medidas.vv!.scale
            },
            addEventListener: (tipo: 'resize' | 'scroll', oyente: () => void): void => {
              oyentes[tipo].add(oyente)
            },
            removeEventListener: (tipo: 'resize' | 'scroll', oyente: () => void): void => {
              oyentes[tipo].delete(oyente)
            },
          },
    addEventListener: (_tipo: 'resize', oyente: () => void): void => {
      oyentes.ventana.add(oyente)
    },
    removeEventListener: (_tipo: 'resize', oyente: () => void): void => {
      oyentes.ventana.delete(oyente)
    },
  }
  return {
    ventana: ventana as unknown as VentanaDeTeclado,
    cambiar(parcial: Partial<{ height: number; offsetTop: number; scale: number }>, evento: 'resize' | 'scroll' = 'resize'): void {
      Object.assign(medidas.vv!, parcial)
      emitir(oyentes[evento])
    },
    girar(alto: number): void {
      medidas.innerHeight = alto
      emitir(oyentes.ventana)
    },
    oyentes: (): number => oyentes.ventana.size + oyentes.resize.size + oyentes.scroll.size,
  }
}

test('crear el monitor no pone ningún oyente; el primero que se suscribe mide en el acto y avisa a la raíz', () => {
  const pantalla = pantallaFalsa(780, { height: 480, offsetTop: 0, scale: 1 }) // el teclado ya estaba abierto al montarse la primera hoja
  const aplicados: number[] = []
  const monitor = crearMonitorDeTeclado(pantalla.ventana, (inset) => aplicados.push(inset))
  assert.equal(pantalla.oyentes(), 0)
  assert.equal(monitor.leer(), 0)

  const desuscribir = monitor.suscribir(() => {})
  assert.equal(monitor.leer(), 300)
  assert.deepEqual(aplicados, [300])
  assert.equal(pantalla.oyentes(), 3) // resize y scroll del visualViewport, y resize de la ventana
  desuscribir()
})

test('subir y bajar el teclado cambia leer(), llama a aplicar y avisa una vez por cambio; el mismo valor no avisa', () => {
  const pantalla = pantallaFalsa(780, { height: 780, offsetTop: 0, scale: 1 })
  const aplicados: number[] = []
  const monitor = crearMonitorDeTeclado(pantalla.ventana, (inset) => aplicados.push(inset))
  let avisos = 0
  monitor.suscribir(() => {
    avisos++
  })
  assert.deepEqual([monitor.leer(), avisos, aplicados], [0, 0, []]) // sin teclado no hay nada que aplicar

  pantalla.cambiar({ height: 480 })
  assert.deepEqual([monitor.leer(), avisos, aplicados], [300, 1, [300]])
  pantalla.cambiar({ height: 480 }) // el navegador repite el evento: mismo valor
  assert.deepEqual([monitor.leer(), avisos, aplicados], [300, 1, [300]])
  pantalla.cambiar({ offsetTop: 100 }, 'scroll') // iOS desplaza el visualViewport: el teclado «baja» 100 px respecto de la capa fija
  assert.deepEqual([monitor.leer(), avisos, aplicados], [200, 2, [300, 200]])
  pantalla.cambiar({ height: 780, offsetTop: 0 })
  assert.deepEqual([monitor.leer(), avisos, aplicados], [0, 3, [300, 200, 0]])
})

test('un giro de pantalla (resize de la ventana) también vuelve a medir', () => {
  const pantalla = pantallaFalsa(780, { height: 480, offsetTop: 0, scale: 1 })
  const monitor = crearMonitorDeTeclado(pantalla.ventana, () => {})
  monitor.suscribir(() => {})
  assert.equal(monitor.leer(), 300)
  pantalla.girar(500) // apaisado: la ventana mide menos y el visualViewport sigue en 480
  assert.equal(monitor.leer(), 20)
})

test('con el zoom de pellizco no hay teclado: iOS deja innerHeight quieto y el visualViewport se encoge, y eso no es un teclado', () => {
  const pantalla = pantallaFalsa(780, { height: 390, offsetTop: 0, scale: 2 })
  const monitor = crearMonitorDeTeclado(pantalla.ventana, () => {})
  monitor.suscribir(() => {})
  assert.equal(monitor.leer(), 0)
  assert.equal(tecladoAbierto(monitor.leer()), false)
  pantalla.cambiar({ scale: 1, height: 480 }) // al volver a 1x, la misma medida sí es un teclado
  assert.equal(monitor.leer(), 300)
})

test('los valores se redondean a píxeles enteros: un teclado con 299.5 px no hace temblar la capa', () => {
  const pantalla = pantallaFalsa(780, { height: 480.5, offsetTop: 0, scale: 1 })
  const monitor = crearMonitorDeTeclado(pantalla.ventana, () => {})
  monitor.suscribir(() => {})
  assert.equal(monitor.leer(), 300) // 299.5 redondea a 300
  pantalla.cambiar({ height: 480.2 })
  assert.equal(monitor.leer(), 300) // 299.8 también: no hay cambio y no se avisa de nada
})

test('sin visualViewport (un navegador viejo) el inset es 0 y no se pone ningún oyente', () => {
  const pantalla = pantallaFalsa(780, null)
  const monitor = crearMonitorDeTeclado(pantalla.ventana, () => {})
  const desuscribir = monitor.suscribir(() => {})
  assert.equal(monitor.leer(), 0)
  assert.equal(pantalla.oyentes(), 1) // solo el resize de la ventana, por si aparece después
  desuscribir()
  assert.equal(pantalla.oyentes(), 0)
})

test('la misma función suscrita dos veces recibe dos avisos y cada suscripción se cancela por separado', () => {
  const pantalla = pantallaFalsa(780, { height: 780, offsetTop: 0, scale: 1 })
  const monitor = crearMonitorDeTeclado(pantalla.ventana, () => {})
  let avisos = 0
  const aviso = (): void => {
    avisos++
  }
  const primera = monitor.suscribir(aviso)
  const segunda = monitor.suscribir(aviso)
  pantalla.cambiar({ height: 480 })
  assert.equal(avisos, 2)
  primera()
  pantalla.cambiar({ height: 780 })
  assert.equal(avisos, 3) // la segunda sigue
  segunda()
  assert.equal(pantalla.oyentes(), 0)
})

test('el último que se desuscribe quita todos los oyentes y devuelve la raíz a 0; con otro suscrito todo sigue', () => {
  const pantalla = pantallaFalsa(780, { height: 480, offsetTop: 0, scale: 1 })
  const aplicados: number[] = []
  const monitor = crearMonitorDeTeclado(pantalla.ventana, (inset) => aplicados.push(inset))
  const primero = monitor.suscribir(() => {})
  const segundo = monitor.suscribir(() => {})
  assert.equal(pantalla.oyentes(), 3) // los oyentes se ponen una vez, no una por suscriptor

  primero()
  assert.equal(pantalla.oyentes(), 3)
  pantalla.cambiar({ height: 780 })
  assert.equal(monitor.leer(), 0) // el que queda sigue recibiendo los cambios

  pantalla.cambiar({ height: 480 })
  segundo()
  segundo() // desuscribir dos veces no rompe nada
  assert.equal(pantalla.oyentes(), 0)
  assert.equal(monitor.leer(), 0)
  assert.equal(aplicados[aplicados.length - 1], 0) // la raíz no se queda con el alto de un teclado que ya nadie sigue
})

// --- El bloqueo de scroll -------------------------------------------------------------------------------------------------------

type Cuerpo = Parameters<typeof crearBloqueoDeScroll>[1]

/** Una ventana y un cuerpo falsos: `scrollTo` anota adónde se pidió volver, y el cuerpo es solo su `style`. */
function paginaFalsa(scrollY: number, estiloPrevio: Record<string, string> = {}) {
  const llamadas: Array<[number, number]> = []
  const win = {
    scrollY,
    scrollTo(x: number, y: number): void {
      llamadas.push([x, y])
    },
  }
  const style = { position: '', top: '', left: '', right: '', width: '', ...estiloPrevio }
  return { win, cuerpo: { style } as unknown as Cuerpo, style, llamadas }
}

test('bloquear fija el cuerpo con position: fixed desplazado lo que se había bajado, y liberar lo deja como estaba y vuelve a ese punto', () => {
  const p = paginaFalsa(340)
  const bloquear = crearBloqueoDeScroll(p.win, p.cuerpo)
  const liberar = bloquear()
  assert.deepEqual({ ...p.style }, { position: 'fixed', top: '-340px', left: '0', right: '0', width: '100%' })

  liberar()
  assert.deepEqual({ ...p.style }, { position: '', top: '', left: '', right: '', width: '' })
  assert.deepEqual(p.llamadas, [[0, 340]])
})

test('liberar devuelve el estilo en línea que había, no lo borra', () => {
  const p = paginaFalsa(0, { position: 'relative', width: '90%' })
  const liberar = crearBloqueoDeScroll(p.win, p.cuerpo)()
  assert.equal(p.style.position, 'fixed')
  liberar()
  assert.deepEqual({ ...p.style }, { position: 'relative', top: '', left: '', right: '', width: '90%' })
})

test('una hoja sobre otra: la de abajo conserva el bloqueo y el scroll vuelve solo al cerrar la última', () => {
  const p = paginaFalsa(500)
  const bloquear = crearBloqueoDeScroll(p.win, p.cuerpo)
  const liberarPadre = bloquear()
  p.win.scrollY = 0 // con el cuerpo fijo la ventana ya no se desplaza: el segundo bloqueo no puede medir otra vez
  const liberarHija = bloquear()
  assert.equal(p.style.top, '-500px') // el segundo no pisa lo que guardó el primero

  liberarHija()
  assert.equal(p.style.position, 'fixed') // sigue bloqueado: la hoja de abajo está abierta
  assert.deepEqual(p.llamadas, [])

  liberarPadre()
  assert.equal(p.style.position, '')
  assert.deepEqual(p.llamadas, [[0, 500]]) // al punto de antes del primer bloqueo
})

test('liberar dos veces la misma hoja no libera la de abajo', () => {
  const p = paginaFalsa(120)
  const bloquear = crearBloqueoDeScroll(p.win, p.cuerpo)
  const liberarPadre = bloquear()
  const liberarHija = bloquear()
  liberarHija()
  liberarHija() // StrictMode, o un cierre que llega dos veces
  assert.equal(p.style.position, 'fixed')
  liberarPadre()
  assert.equal(p.style.position, '')
  assert.deepEqual(p.llamadas, [[0, 120]]) // y una sola vuelta al punto
})

test('después de liberar todo, un bloqueo nuevo mide de nuevo desde donde está la página', () => {
  const p = paginaFalsa(200)
  const bloquear = crearBloqueoDeScroll(p.win, p.cuerpo)
  bloquear()()
  p.win.scrollY = 75
  const liberar = bloquear()
  assert.equal(p.style.top, '-75px')
  liberar()
  assert.deepEqual(p.llamadas, [[0, 200], [0, 75]])
})

test('activo() dice si hay alguna hoja bloqueando: desde el primer bloqueo hasta liberar el último', () => {
  const p = paginaFalsa(300)
  const bloquear = crearBloqueoDeScroll(p.win, p.cuerpo)
  assert.equal(bloquear.activo(), false, 'sin hojas no hay bloqueo')
  const liberarPadre = bloquear()
  assert.equal(bloquear.activo(), true)
  const liberarHija = bloquear()
  liberarPadre()
  assert.equal(bloquear.activo(), true, 'la hoja de arriba sigue abierta')
  liberarHija()
  assert.equal(bloquear.activo(), false)
})

test('activo() no se cuenta de menos si una misma hoja se libera dos veces, ni queda activo después de soltar todo', () => {
  const p = paginaFalsa(50)
  const bloquear = crearBloqueoDeScroll(p.win, p.cuerpo)
  const liberarPadre = bloquear()
  const liberarHija = bloquear()
  liberarHija()
  liberarHija() // un cierre doble no libera la hoja de abajo
  assert.equal(bloquear.activo(), true)
  liberarPadre()
  assert.equal(bloquear.activo(), false)
})

test('scrollBloqueado sin ninguna hoja abierta dice que no, y preguntarlo no crea el bloqueo ni toca window (aquí no hay)', () => {
  assert.equal(scrollBloqueado(), false)
})
