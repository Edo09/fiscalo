// Los motivos de un rechazo, tal como los dice la DGII (anexo 6.3): `respuesta_dgii.mensajes` y, si no hay, `mensaje` y luego `error`. El texto es de la DGII y se muestra
// tal cual (nunca se reescribe ni se corta): solo se recortan los bordes, se descartan los vacíos y se quitan los repetidos. Lo que no se puede leer no inventa motivos:
// da una lista vacía, y la pantalla dice entonces solo que la DGII rechazó el comprobante.

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** El texto recortado, o null si no hay nada que decir: lo que no es texto, el vacío y los espacios solos. */
function texto(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const limpio = v.trim()
  return limpio === '' ? null : limpio
}

/** La respuesta como objeto: el texto JSON de la columna se lee y un objeto ya leído pasa. Lo que no es JSON, o es JSON que no es un objeto, no tiene motivos. */
function comoObjeto(v: unknown): Record<string, unknown> | null {
  let valor = v
  if (typeof v === 'string') {
    try {
      valor = JSON.parse(v)
    } catch {
      return null
    }
  }
  return esObjeto(valor) ? valor : null
}

/**
 * Los motivos de la respuesta de la DGII (`respuesta_dgii`: el texto JSON de la columna o el objeto ya leído, `FacturaVista.respuestaDgii`). Primero `mensajes`: cada entrada es un
 * texto o un objeto `{ valor, codigo }` cuyo texto es `valor`. Si de ahí no sale ninguno, el texto de `mensaje` y, si tampoco, el de `error`: uno solo, el primero que diga algo.
 * Sin repetidos (la primera vez gana el lugar) y en el orden en que vienen.
 */
export function extraerMotivos(respuestaDgii: unknown): string[] {
  const respuesta = comoObjeto(respuestaDgii)
  if (respuesta === null) return []
  const motivos = new Set<string>()
  for (const entrada of Array.isArray(respuesta.mensajes) ? respuesta.mensajes : []) {
    const motivo = texto(esObjeto(entrada) ? entrada.valor : entrada)
    if (motivo !== null) motivos.add(motivo)
  }
  if (motivos.size > 0) return [...motivos]
  const respaldo = texto(respuesta.mensaje) ?? texto(respuesta.error)
  return respaldo === null ? [] : [respaldo]
}
