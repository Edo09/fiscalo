// Ningún componente ni gancho de Express cambia su propio estado mientras se dibuja: nada de `if (ruta !== fondo) setFondo(ruta)` en el cuerpo de la función.
//
// Por qué se vigila. En React 18.3.1, cuando un componente cambia su estado durante el dibujo React repite el dibujo (`renderWithHooks`), y el `useSyncExternalStore` de esa
// segunda pasada compara el valor del store contra el gancho de la primera pasada, que ya lo trae (`updateSyncExternalStore`: `prevSnapshot = hook.memoizedState`). No ve
// ningún cambio y no agenda el efecto que anota el valor en la instancia del store (`inst.value`), así que la instancia se queda con el de antes: el siguiente cambio del
// store de vuelta a ese valor se juzga «sin cambio» y el componente no vuelve a dibujarse. Es lo que pasó en App.tsx: `#/productos`, `#/mas`, `#/productos`, `#/mas` y Más
// no se abría la segunda vez, con la barra (otro componente) al día y `Autenticada` con el hash viejo. Se midió con la instancia a la vista (`hook.memoizedState` y
// `inst.value` del fiber) y con un `useSyncExternalStore` crudo sobre `location.hash`, sin `useRuta` ni `router.ts`: no es del router. Cualquier lectura de un store externo
// lo sufre (`useSession`, `useQuery`, `useRuta`...), y casi todo componente de Express lee alguno.
//
// Lo que se hace en su lugar: derivar el valor al dibujar, o guardarlo en una referencia que un efecto deja al día (como `ultimaPantalla` en App.tsx), o cambiar el estado
// desde un manejador o un efecto. Aquí no hay DOM para montar los componentes y comprobarlo en vivo, así que se vigila la forma: se lee cada archivo con el compilador
// de TypeScript y se busca la llamada al cambiador de un estado propio que cae en el cuerpo de la función y no dentro de otra función (un manejador, un efecto).
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const RAIZ = fileURLToPath(new URL('../', import.meta.url)) // express/, con separador final

const esFuncion = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isSetAccessorDeclaration(n)

/** El nombre con que se llama a `llamada` (`useState`, o `React.useState`); '' si no es un identificador ni un acceso a una propiedad. */
function nombreLlamado(llamada: ts.CallExpression): string {
  const f = llamada.expression
  if (ts.isIdentifier(f)) return f.text
  return ts.isPropertyAccessExpression(f) ? f.name.text : ''
}

/** ¿Es `n` la función que se le pasa a un `useMemo`? Corre al dibujar, no después: lo que cambie ahí también cambia el estado en pleno dibujo. */
function esDeUseMemo(n: ts.Node): boolean {
  const padre = n.parent
  return ts.isCallExpression(padre) && padre.arguments[0] === n && nombreLlamado(padre) === 'useMemo'
}

/**
 * Los nombres de los cambiadores de estado que `fn` declara en su propio cuerpo: el segundo de `const [valor, setValor] = useState(...)` (o `useReducer`, o un gancho
 * propio `useAlgo` cuyo segundo valor se llame `set...` o `dispatch`). Lo que declaren las funciones anidadas es de ellas.
 */
function cambiadoresDe(fn: ts.FunctionLikeDeclaration): Set<string> {
  const nombres = new Set<string>()
  const visitar = (n: ts.Node): void => {
    if (esFuncion(n)) return
    if (ts.isVariableDeclaration(n) && ts.isArrayBindingPattern(n.name) && n.initializer !== undefined && ts.isCallExpression(n.initializer)) {
      const segundo = n.name.elements[1]
      if (/^use[A-Z]/.test(nombreLlamado(n.initializer)) && segundo !== undefined && ts.isBindingElement(segundo) && ts.isIdentifier(segundo.name)) {
        if (/^(set[A-Z]|dispatch$)/.test(segundo.name.text)) nombres.add(segundo.name.text)
      }
    }
    ts.forEachChild(n, visitar)
  }
  if (fn.body !== undefined) visitar(fn.body)
  return nombres
}

interface Ajuste {
  /** La línea (desde 1) de la llamada. */
  linea: number
  cambiador: string
}

/** Las llamadas a un cambiador de estado propio que caen en el cuerpo de una función de `codigo` (al dibujar), y no en un manejador, un efecto u otra función. */
function ajustesAlDibujar(codigo: string, nombre: string): Ajuste[] {
  const archivo = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.ES2022, true, nombre.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const hallados: Ajuste[] = []

  const revisar = (fn: ts.FunctionLikeDeclaration): void => {
    const cambiadores = cambiadoresDe(fn)
    if (cambiadores.size === 0 || fn.body === undefined) return
    const buscar = (n: ts.Node): void => {
      if (esFuncion(n) && !esDeUseMemo(n)) return // un manejador o un efecto: corre después del dibujo
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && cambiadores.has(n.expression.text)) {
        hallados.push({ linea: archivo.getLineAndCharacterOfPosition(n.getStart(archivo)).line + 1, cambiador: n.expression.text })
      }
      ts.forEachChild(n, buscar)
    }
    buscar(fn.body)
  }
  const recorrer = (n: ts.Node): void => {
    if (esFuncion(n)) revisar(n)
    ts.forEachChild(n, recorrer)
  }
  recorrer(archivo)
  return hallados
}

// --- El detector ---------------------------------------------------------------------------------------------------------------

test('el detector ve el patrón que rompió Más: `if (...) setFondo(ruta)` en el cuerpo del componente', () => {
  const codigo = `
function Autenticada() {
  const ruta = useRuta()
  const [fondo, setFondo] = useState(ruta)
  if (ruta.id !== 'mas' && ruta !== fondo) setFondo(ruta)
  return null
}`
  assert.deepEqual(ajustesAlDibujar(codigo, 'a.tsx'), [{ linea: 5, cambiador: 'setFondo' }])
})

test('el detector ve también useReducer, un gancho propio, un componente flecha, un useMemo y la forma `cond && set(...)`', () => {
  const codigo = `
export function A() {
  const [n, dispatch] = useReducer(f, 0)
  dispatch({ tipo: 'x' })
}
export function B() {
  const [v, setV] = useLocal('clave')
  setV(1)
}
export const C = () => {
  const [v, setV] = useState(0)
  v > 3 && setV(0)
  return v
}
export function D() {
  const [v, setV] = useState(0)
  const doble = useMemo(() => { setV(2); return v * 2 }, [v])
  return doble
}
export function E() {
  const [v, setV] = React.useState(0)
  if (v === 0) setV?.(1)
}`
  assert.deepEqual(
    ajustesAlDibujar(codigo, 'b.tsx').map((a) => `${a.linea}:${a.cambiador}`),
    ['4:dispatch', '8:setV', '12:setV', '17:setV', '22:setV'],
  )
})

test('el detector deja pasar lo que corre después del dibujo: efectos, manejadores, callbacks y el estado ajeno', () => {
  const codigo = `
function Pantalla() {
  const [fondo, setFondo] = useState(0)
  const ultima = useRef(0)
  useEffect(() => { setFondo(1) }, [])
  useLayoutEffect(() => setFondo(2), [])
  const alTocar = () => setFondo(3)
  const alCambiar = useCallback(function () { setFondo(4) }, [])
  const hijo = (id) => { if (id) setFondo(id) }
  ultima.current = fondo
  return <button onClick={() => setFondo(5)} onChange={alCambiar} data-x={setFondo.length}>{alTocar.name}{hijo.name}</button>
}
function Otra() {
  const [dato, setDato] = useState(0)
  return <Pantalla poner={setDato} />
}
function SinEstado(p) {
  p.setFondo(1)
  setFondo(2)
}`
  assert.deepEqual(ajustesAlDibujar(codigo, 'c.tsx'), [])
})

test('el detector no confunde el cambiador de un componente con el de otro', () => {
  const codigo = `
function Padre() {
  const [a, setA] = useState(0)
  function Hijo() {
    const [b, setB] = useState(0)
    setA(1)
    setB(1)
  }
  return Hijo
}`
  // `setB` es del Hijo y sí es al dibujar; `setA` es del Padre y el Hijo lo llama dentro de otra función: no es el dibujo del Padre.
  assert.deepEqual(ajustesAlDibujar(codigo, 'd.tsx'), [{ linea: 7, cambiador: 'setB' }])
})

// --- El código de Express -------------------------------------------------------------------------------------------------------

/** Todos los .ts y .tsx de `carpeta` y sus subcarpetas (sin los .d.ts), en orden alfabético. */
function fuentes(carpeta: string): string[] {
  const entradas = readdirSync(carpeta, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
  return entradas.flatMap((entrada) => {
    const ruta = join(carpeta, entrada.name)
    if (entrada.isDirectory()) return fuentes(ruta)
    return /\.tsx?$/.test(entrada.name) && !entrada.name.endsWith('.d.ts') ? [ruta] : []
  })
}

test('express/src: ningún componente ni gancho cambia su propio estado al dibujarse', () => {
  const carpeta = join(RAIZ, 'src')
  assert.ok(existsSync(join(carpeta, 'App.tsx')), 'la carpeta que se recorre es express/src')
  const archivos = fuentes(carpeta)
  assert.ok(archivos.length > 40, `se recorrieron ${archivos.length} archivos: la búsqueda no puede pasar sin mirar nada`)

  const malos = archivos.flatMap((ruta) =>
    ajustesAlDibujar(readFileSync(ruta, 'utf8'), ruta).map((a) => `${relative(RAIZ, ruta).replace(/\\/g, '/')}:${a.linea}  ${a.cambiador}() al dibujar`),
  )
  assert.deepEqual(malos, [], 'cambiar el estado al dibujar rompe el useSyncExternalStore de ese componente (ver el encabezado de esta prueba): usa una referencia con un efecto, o un manejador')
})
