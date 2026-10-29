// Todo el localStorage de la app pasa por aquí (el lint lo prohíbe en cualquier otro archivo). Con el storage bloqueado (ventana privada,
// cookies bloqueadas) o lleno, `localStorage` lanza al leerlo o al escribirlo: aquí nada lanza, y lo escrito se recuerda en memoria
// mientras viva la página. Sirve para conveniencias (borrador, preferencias, tema), nunca para estado que deba persistir sin falta.

/**
 * Lo último que se escribió o se borró en cada clave cuya operación no llegó al storage: el texto, o `null` si se borró. Mientras una
 * clave esté aquí manda sobre el storage, que puede conservar un valor viejo o ni dejar leer; una escritura o un borrado que sí llega la
 * saca de aquí. Es del módulo: dura lo que la página.
 */
const respaldo = new Map<string, string | null>()

/** El texto de `clave`, o null si no hay. Con el storage bloqueado, lo último escrito en memoria. */
export function leerTexto(clave: string): string | null {
  if (respaldo.has(clave)) return respaldo.get(clave) ?? null
  try {
    return localStorage.getItem(clave)
  } catch {
    return null
  }
}

/** Guarda `valor` tal cual, sin pasarlo por JSON (el tema y la bandera de la vista previa los lee también un script clásico). */
export function escribirTexto(clave: string, valor: string): void {
  try {
    localStorage.setItem(clave, valor)
    respaldo.delete(clave)
  } catch {
    respaldo.set(clave, valor)
  }
}

/** Quita `clave`. Si el storage no deja, la lectura da null igual aunque el valor siga ahí. */
export function borrar(clave: string): void {
  try {
    localStorage.removeItem(clave)
    respaldo.delete(clave)
  } catch {
    respaldo.set(clave, null)
  }
}

/** El valor de `clave`, o null si no hay o el texto no es JSON. El tipo `T` es una promesa de quien llama: aquí no se valida. */
export function leerJson<T>(clave: string): T | null {
  const texto = leerTexto(clave)
  if (texto === null) return null
  try {
    return JSON.parse(texto) as T
  } catch {
    return null
  }
}

/**
 * Guarda `valor` como JSON. `undefined` (o una función, o un símbolo) es «nada»: borra la clave en vez de dejar el texto "undefined".
 * Un valor que no se puede serializar (con un ciclo, o con un BigInt) no lanza ni pisa lo que había.
 */
export function escribirJson(clave: string, valor: unknown): void {
  let texto: string | undefined
  try {
    texto = JSON.stringify(valor)
  } catch {
    return
  }
  if (texto === undefined) borrar(clave)
  else escribirTexto(clave, texto)
}

/**
 * La clave de un dato de este usuario en esta empresa: `fx:v1:{tenantId}:{userId}:{que}`. La `v1` deja cambiar el formato de las claves
 * sin tener que leer lo que dejó el anterior.
 */
export function claveUsuario(tenantId: number, userId: number, que: string): string {
  return `fx:v1:${tenantId}:${userId}:${que}`
}

/** Borra los datos `que` de este usuario (`['borrador', 'recientes']`); lo demás suyo y lo de otros usuarios y empresas se queda. */
export function purgarUsuario(tenantId: number, userId: number, que: readonly string[]): void {
  for (const dato of que) borrar(claveUsuario(tenantId, userId, dato))
}
