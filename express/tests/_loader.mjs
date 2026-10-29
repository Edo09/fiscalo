// Precarga de las pruebas de Express: `node --import ./express/tests/_loader.mjs --test express/tests/<f>.test.ts`.
// Deja a Node listo para importar el código de la app como lo hace Vite (los alias y las extensiones están en hooks.mjs).
import { register } from 'node:module'

// Node no tiene `import.meta.env`: hooks.mjs lo sustituye por `globalThis.__VITE_ENV__`. Se define aquí y las pruebas
// pueden mutarlo (`__VITE_ENV__.DEV = true`).
globalThis.__VITE_ENV__ = { MODE: 'test', DEV: false, PROD: false, BASE_URL: '/' }

// Mientras valga `true`, `setItem` de este localStorage lanza QuotaExceededError, como un storage lleno. Es una bandera y
// no una función de ayudas.ts porque el store de sesión (zustand `persist`) toma este mismo objeto al importarse, antes
// de que corra ninguna prueba, y ya no se le puede cambiar por otro.
globalThis.__CUOTA_LLENA__ = false

// localStorage en memoria, definido antes de cualquier import: sin él, el store de sesión tomaría el de Node, que en Node 22
// no existe y en Node 25, sin `--localstorage-file`, no funciona (`setItem` no es una función) y avisa.
const datos = new Map()
const almacenInicial = {
  get length() {
    return datos.size
  },
  key: (i) => [...datos.keys()][i] ?? null,
  getItem: (clave) => datos.get(String(clave)) ?? null,
  setItem(clave, valor) {
    if (globalThis.__CUOTA_LLENA__ === true) {
      throw new DOMException(`Failed to execute 'setItem' on 'Storage': Setting the value of '${clave}' exceeded the quota.`, 'QuotaExceededError')
    }
    datos.set(String(clave), String(valor))
  },
  removeItem: (clave) => {
    datos.delete(String(clave))
  },
  clear: () => {
    datos.clear()
  },
}
Object.defineProperty(globalThis, 'localStorage', { value: almacenInicial, configurable: true, enumerable: true, writable: true })

register('./hooks.mjs', import.meta.url)
