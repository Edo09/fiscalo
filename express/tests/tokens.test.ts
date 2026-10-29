// Tokens de diseño de Express (express/src/styles/tokens.css). Cinco garantías: los colores, radios y sombras que Express toma de la app
// completa valen lo mismo que allá (el valor efectivo tras bold.css) en los dos temas; la paleta oscura, que tiene que estar dos veces (por
// el sistema y por el atributo), es idéntica en las dos; los tokens nuevos del móvil tienen los valores del contrato; las parejas de texto
// y fondo dan 4.5:1 en el claro y en el oscuro; y el anillo de foco del teclado (base.css, con --focus) da 3:1 sobre los fondos en los dos
// temas. Los CSS se leen desde la ubicación de esta prueba, no desde el directorio de trabajo.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const leer = (ruta: string): string => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8') // ruta desde fiscalo/

// --- Un lector de CSS: lo justo para estos archivos -------------------------------------------------------------------------------
// Bloques `preludio { declaraciones }`, anidados (un @media con su :root dentro). Los comentarios no cuentan, y las cadenas y los
// paréntesis no se parten (un `;` dentro de un `url()` no termina la declaración).

type Bloque = { preludio: string; declaraciones: Array<[string, string]>; hijos: Bloque[] }
type Mapa = Record<string, string>

const compactar = (texto: string): string => texto.replace(/\s+/g, ' ').trim()

/** Los bloques de primer nivel de `css`; cada uno trae sus declaraciones (propiedad, valor) y los bloques que contiene. */
function analizar(css: string): Bloque[] {
  const texto = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const raiz: Bloque = { preludio: '', declaraciones: [], hijos: [] }
  const abiertos: Bloque[] = [raiz]
  let inicio = 0
  let parentesis = 0
  let comilla = ''
  const cerrarSentencia = (fin: number): void => {
    const sentencia = texto.slice(inicio, fin)
    const dosPuntos = sentencia.indexOf(':')
    if (dosPuntos > 0) abiertos[abiertos.length - 1].declaraciones.push([compactar(sentencia.slice(0, dosPuntos)), compactar(sentencia.slice(dosPuntos + 1))])
    inicio = fin + 1
  }
  for (let i = 0; i < texto.length; i++) {
    const letra = texto[i]
    if (comilla !== '') {
      if (letra === '\\') i++
      else if (letra === comilla) comilla = ''
    } else if (letra === '"' || letra === "'") {
      comilla = letra
    } else if (letra === '(') {
      parentesis++
    } else if (letra === ')') {
      parentesis--
    } else if (parentesis === 0 && letra === '{') {
      const bloque: Bloque = { preludio: compactar(texto.slice(inicio, i)), declaraciones: [], hijos: [] }
      abiertos[abiertos.length - 1].hijos.push(bloque)
      abiertos.push(bloque)
      inicio = i + 1
    } else if (parentesis === 0 && (letra === ';' || letra === '}')) {
      cerrarSentencia(i)
      if (letra === '}') {
        assert.ok(abiertos.length > 1, 'CSS con una } de mas')
        abiertos.pop()
      }
    }
  }
  assert.equal(abiertos.length, 1, 'CSS con una { sin cerrar')
  return raiz.hijos
}

/** Las declaraciones de esos bloques como un solo mapa propiedad -> valor; si una propiedad se repite gana la última, como en la cascada. */
const mapa = (...bloques: Bloque[]): Mapa => Object.fromEntries(bloques.flatMap((bloque) => bloque.declaraciones))

/** Los bloques de este nivel cuyo selector (o @media) es exactamente `preludio`, en el orden del archivo. */
const bloquesDe = (nivel: Bloque[], preludio: string): Bloque[] => nivel.filter((bloque) => bloque.preludio === preludio)

/** El único bloque de la lista; si falta o se repite, la prueba falla diciendo cuál. */
function unico(bloques: Bloque[], nombre: string): Bloque {
  assert.equal(bloques.length, 1, `${nombre}: tiene que haber exactamente un bloque y hay ${bloques.length}`)
  return bloques[0]
}

// --- Contraste (WCAG 2.x) ---------------------------------------------------------------------------------------------------------

/** Luminancia relativa de un color `#rrggbb`. */
function luminancia(color: string): number {
  assert.match(String(color), /^#[0-9a-f]{6}$/i, `no es un color #rrggbb: ${color}`)
  const [rojo, verde, azul] = [1, 3, 5].map((i) => {
    const canal = parseInt(color.slice(i, i + 2), 16) / 255
    return canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * rojo + 0.7152 * verde + 0.0722 * azul
}

/** Relación de contraste entre dos colores `#rrggbb`, de 1 a 21, vaya primero el que vaya. */
function ratio(a: string, b: string): number {
  const [mayor, menor] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (mayor + 0.05) / (menor + 0.05)
}

/** El valor de `token` en `tema` con sus `var(--otro)` ya sustituidos, como los calcula el navegador (solo la forma simple, sin respaldo). */
function resolver(tema: Mapa, token: string, visitados: string[] = []): string {
  assert.ok(!visitados.includes(token), `referencia circular: ${[...visitados, token].join(' -> ')}`)
  assert.ok(token in tema, `${token} no esta definido`)
  return tema[token].replace(/var\((--[a-z0-9-]+)\)/g, (_, otro: string) => resolver(tema, otro, [...visitados, token]))
}

// --- Los mapas: la app completa y Express -----------------------------------------------------------------------------------------

const styles = analizar(leer('src/styles/styles.css'))
const bold = analizar(leer('src/styles/bold.css'))
const stylesClaro = bloquesDe(styles, ':root')
const stylesOscuro = bloquesDe(styles, '[data-theme="dark"]')
const boldClaro = bloquesDe(bold, ':root')
const boldOscuro = bloquesDe(bold, '[data-theme="dark"]')

// styles.css carga antes que bold.css y, a igual especificidad, gana la última declaración. Con data-theme="dark" valen los cuatro bloques en
// el orden en que cargan: el :root de bold.css les gana a las sombras oscuras de styles.css, y por eso bold.css las repite en su propio
// [data-theme="dark"]. Lo efectivo es esto, no cada archivo por separado.
const appClaro = mapa(...stylesClaro, ...boldClaro)
const appOscuro = mapa(...stylesClaro, ...stylesOscuro, ...boldClaro, ...boldOscuro)

const tokensCss = analizar(leer('express/src/styles/tokens.css'))
const bloqueMedia = unico(
  bloquesDe(tokensCss, '@media (prefers-color-scheme: dark)').flatMap((media) => bloquesDe(media.hijos, ':root:not([data-theme="light"])')),
  '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }',
)
const bloqueAtributo = unico(bloquesDe(tokensCss, ':root[data-theme="dark"]'), ':root[data-theme="dark"]')
// El bloque oscuro es más específico que :root y solo trae lo que cambia: lo efectivo en oscuro es el claro con el oscuro encima.
const claro = mapa(unico(bloquesDe(tokensCss, ':root'), ':root'))
const oscuro: Mapa = { ...claro, ...mapa(bloqueAtributo) }

// --- Pruebas ----------------------------------------------------------------------------------------------------------------------

// Lo que Express toma de la app completa con el mismo valor (el plan lo escribe con comodines: `--accent*`, `--r-xs..--r-full`).
const DE_LA_APP = [
  '--accent', '--accent-hover', '--accent-active', '--accent-soft', '--accent-soft-2', '--accent-text', '--on-accent',
  '--bg', '--surface', '--surface-2', '--surface-hover', '--surface-active',
  '--border', '--border-strong', '--ring',
  '--text', '--text-2', '--text-3',
  '--success', '--success-soft', '--warning', '--warning-soft', '--danger', '--danger-soft', '--info', '--info-soft', '--neutral-soft',
  '--r-xs', '--r-sm', '--r-md', '--r-lg', '--r-xl', '--r-full',
  '--sh-xs', '--sh-sm', '--sh-md', '--sh-lg', '--sh-pop',
]

test('paridad con la app completa: mismo valor en el tema claro y en el oscuro', () => {
  // El modo oscuro de la app existe y cambia los colores: si el lector no lo hubiera encontrado, appOscuro seria igual a appClaro y la
  // comparacion oscura de abajo no probaria nada.
  for (const token of ['--bg', '--text', '--accent']) assert.notEqual(appOscuro[token], appClaro[token], `la app completa no cambia ${token} en oscuro`)
  for (const token of DE_LA_APP) {
    assert.notEqual(appClaro[token], undefined, `${token} ya no esta en la app completa: la lista de esta prueba quedo vieja`)
    assert.equal(claro[token], appClaro[token], `claro ${token}`)
    assert.equal(oscuro[token], appOscuro[token], `oscuro ${token}`)
  }
})

test('la pila de fuentes del cuerpo es la del sistema, distinta a proposito de la app completa', () => {
  assert.notEqual(claro['--font-sans'], appClaro['--font-sans'])
  assert.match(claro['--font-sans'], /^system-ui, .*, sans-serif$/)
  // Los titulos piden Space Grotesk y, mientras no haya woff2 o si no carga, caen a la pila del cuerpo.
  assert.equal(claro['--font-display'], '"Space Grotesk", var(--font-sans)')
})

test('no trae lo del escritorio: --sidebar-*, --navbar-h ni --density', () => {
  for (const [nombre, tema] of [['claro', claro], ['oscuro', oscuro]] as const) {
    assert.deepEqual(Object.keys(tema).filter((token) => /^--(sidebar-|navbar-h$|density$)/.test(token)), [], nombre)
  }
})

test('los dos bloques oscuros son identicos', () => {
  assert.deepEqual(mapa(bloqueMedia), mapa(bloqueAtributo))
  assert.ok(Object.keys(mapa(bloqueAtributo)).length > 0, 'el bloque oscuro no puede estar vacio')
})

test('cada token del bloque oscuro tiene su valor en el claro', () => {
  // Sin valor claro, var(--x) no valdria nada en el tema claro.
  assert.deepEqual(Object.keys(mapa(bloqueAtributo)).filter((token) => !(token in claro)), [])
})

test('tokens nuevos', () => {
  const nuevos: Array<[string, string]> = [
    ['--tap', '48px'], ['--tap-lg', '52px'], ['--bar-h', '56px'], ['--top-h', '48px'], ['--kb-inset', '0px'], ['--safe-b', 'env(safe-area-inset-bottom, 0px)'],
    ['--sp-1', '4px'], ['--sp-2', '8px'], ['--sp-3', '12px'], ['--sp-4', '16px'], ['--sp-5', '20px'], ['--sp-6', '24px'], ['--gutter', '16px'],
    ['--z-bar', '10'], ['--z-accion', '20'], ['--z-banner', '30'], ['--z-fondo', '40'], ['--z-sheet', '50'], ['--z-toast', '60'],
    ['--mov-rapido', '150ms'], ['--mov', '200ms'],
    ['--warning-text', '#8a5608'], ['--success-text', '#17694a'], ['--danger-text', '#a82a2a'],
    ['--focus', 'var(--accent)'], // sin repetirlo en los bloques oscuros: --accent ya cambia allí y --focus lo sigue
  ]
  for (const [token, valor] of nuevos) assert.equal(claro[token], valor, token)
})

test('contraste 4.5:1 en los dos temas', () => {
  const parejas = [
    ['--text', '--bg'], ['--text', '--surface'], ['--text-2', '--bg'], ['--text-2', '--surface'], ['--on-accent', '--accent'],
    ['--accent-text', '--accent-soft'], ['--warning-text', '--warning-soft'], ['--success-text', '--success-soft'], ['--danger-text', '--danger-soft'],
    ['--text-2', '--neutral-soft'],
  ]
  for (const [texto, fondo] of parejas) {
    for (const [nombre, tema] of [['claro', claro], ['oscuro', oscuro]] as const) {
      const relacion = ratio(tema[texto], tema[fondo])
      assert.ok(relacion >= 4.5, `${nombre}: ${texto} ${tema[texto]} sobre ${fondo} ${tema[fondo]} da ${relacion.toFixed(2)}:1`)
    }
  }
})

// WCAG 1.4.11 (contraste de lo que no es texto) pide 3:1 al indicador de foco. --ring, el halo translúcido de la app completa, mezclado con
// el fondo da 1.5:1 en el claro y de 2.1 a 2.2:1 en el oscuro, y la app completa nunca lo usa solo: va junto a un borde --accent (.input).
// El anillo de base.css usa --focus, el acento sólido, que es lo que la app completa pinta como foco de teclado (bold.css, .btn:focus-visible).
test('el anillo de foco: base.css usa --focus y --focus da 3:1 sobre los fondos en los dos temas', () => {
  const base = analizar(leer('express/src/styles/base.css'))
  assert.equal(mapa(unico(bloquesDe(base, ':focus'), 'base.css :focus')).outline, '3px solid var(--focus)')
  assert.equal(mapa(unico(bloquesDe(base, ':focus:not(:focus-visible)'), 'base.css :focus:not(:focus-visible)')).outline, 'none')
  // Los fondos donde puede caer un control con foco: la pantalla, las tarjetas y las franjas de estado.
  const fondos = [
    '--bg', '--surface', '--surface-2', '--surface-hover', '--surface-active', '--neutral-soft',
    '--accent-soft', '--success-soft', '--warning-soft', '--danger-soft',
  ]
  for (const [nombre, tema] of [['claro', claro], ['oscuro', oscuro]] as const) {
    // Un color sin transparencia: con rgba() `ratio` falla, porque sin conocer el fondo no hay contraste que medir.
    const anillo = resolver(tema, '--focus')
    for (const fondo of fondos) {
      const relacion = ratio(anillo, tema[fondo])
      assert.ok(relacion >= 3, `${nombre}: --focus ${anillo} sobre ${fondo} ${tema[fondo]} da ${relacion.toFixed(2)}:1`)
    }
  }
})

test('ratio da los valores conocidos de WCAG (la prueba de contraste vale lo que valga esta funcion)', () => {
  const dosDecimales = (n: number): number => Math.round(n * 100) / 100
  assert.equal(dosDecimales(ratio('#000000', '#ffffff')), 21)
  assert.equal(dosDecimales(ratio('#ffffff', '#000000')), 21) // da igual cual vaya primero
  assert.equal(dosDecimales(ratio('#336699', '#336699')), 1)
  assert.equal(dosDecimales(ratio('#767676', '#ffffff')), 4.54) // el gris mas claro que pasa AA sobre blanco
  assert.equal(dosDecimales(ratio('#777777', '#ffffff')), 4.48) // y el siguiente, que no
  assert.throws(() => ratio('rgba(0, 0, 0, 0.5)', '#ffffff'), /no es un color #rrggbb/)
})
