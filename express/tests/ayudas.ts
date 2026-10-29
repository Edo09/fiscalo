// Ayudas compartidas por las pruebas de Express (el cargador que las habilita está en _loader.mjs).

/** Espera de verdad `ms` milisegundos (por defecto, un turno del bucle de eventos: deja correr las promesas pendientes). */
export const esperar = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Reemplaza `globalThis.localStorage` hasta llamar a `restaurar()`, que devuelve el que había antes.
 * - `'memoria'`: un storage vacío en memoria; `datos` es su contenido, para inspeccionarlo.
 * - `'lanza'`: un storage bloqueado, como el de un navegador con las cookies bloqueadas: leer `localStorage` lanza un
 *   `DOMException` `SecurityError` (nada llega a `datos`, que queda vacío).
 * Un módulo que tomó el `localStorage` al importarse (el store de sesión de zustand) sigue con el suyo: para llenarle la
 * cuota se usa `globalThis.__CUOTA_LLENA__` (ver _loader.mjs).
 */
export function instalarStorage(modo: 'memoria' | 'lanza'): { datos: Map<string, string>; restaurar(): void } {
  const previo = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const datos = new Map<string, string>()
  if (modo === 'memoria') {
    const memoria: Storage = {
      get length() {
        return datos.size
      },
      key: (i) => [...datos.keys()][i] ?? null,
      getItem: (clave) => datos.get(String(clave)) ?? null,
      setItem: (clave, valor) => {
        datos.set(String(clave), String(valor))
      },
      removeItem: (clave) => {
        datos.delete(String(clave))
      },
      clear: () => {
        datos.clear()
      },
    }
    Object.defineProperty(globalThis, 'localStorage', { value: memoria, configurable: true, enumerable: true, writable: true })
  } else {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      enumerable: true,
      get(): never {
        throw new DOMException('Access is denied for this document.', 'SecurityError')
      },
    })
  }
  return {
    datos,
    restaurar() {
      if (previo) Object.defineProperty(globalThis, 'localStorage', previo)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    },
  }
}
