// Qué se tocó en las líneas respecto al documento guardado, para la cotización
// de Ferretería y el conduce: las mismas marcas que la factura simple
// (SimpleInvoiceFormView). Se compara contra una foto en vez de llevar un flag
// "sucio": el usuario ve el campo exacto que cambió, y si lo devuelve a su valor
// la marca se va sola.
//
// A diferencia de la factura simple, las filas en blanco no cuentan (ni al
// tomar la foto ni al comparar): el formulario las descarta al guardar, así que
// agregar una vacía no es un cambio, y vaciar una guardada es borrarla.
//
// Imports de valor SOLO por ruta relativa con .ts y '@/…' solo como
// `import type`: así `node` carga este archivo para
// scripts/test-cambios-ferreteria.ts sin compilar nada.
import type { LineaFerreteriaForm } from './schema.ts'
import { siguienteId } from './lineas.ts'

/** Los campos de una línea que se guardan (los mismos que comparaba la huella de antes). */
export type CampoLinea = 'prodId' | 'descripcion' | 'cantidad' | 'precio' | 'indFact' | 'unidadMedida' | 'tipoItem'

const CAMPOS: readonly CampoLinea[] = ['prodId', 'descripcion', 'cantidad', 'precio', 'indFact', 'unidadMedida', 'tipoItem']

/** Las líneas con contenido, tal como se cargaron o se guardaron por última vez. */
export function fotoLineas(
  lineas: readonly LineaFerreteriaForm[], enBlanco: (l: LineaFerreteriaForm) => boolean,
): LineaFerreteriaForm[] {
  return lineas.filter((l) => !enBlanco(l)).map((l) => ({ ...l }))
}

export interface CambiosLineas {
  /** Línea con contenido que no está en la foto: se agregó en esta edición. */
  esNueva: (l: LineaFerreteriaForm) => boolean
  /** El campo difiere de la foto. En una línea nueva, todos. */
  campoCambiado: (l: LineaFerreteriaForm, campo: CampoLinea) => boolean
  /** Algo cambió: una línea nueva, una quitada (o vaciada), o un campo distinto. */
  hayCambios: boolean
}

/**
 * Compara las líneas en pantalla con la foto. Con `foto` null (documento nuevo,
 * o todavía sin cargar) no hay nada contra qué comparar: nada sale marcado.
 */
export function cambiosLineas(
  foto: readonly LineaFerreteriaForm[] | null,
  lineas: readonly LineaFerreteriaForm[],
  enBlanco: (l: LineaFerreteriaForm) => boolean,
): CambiosLineas {
  if (foto == null) return { esNueva: () => false, campoCambiado: () => false, hayCambios: false }
  const guardadas = new Map(foto.map((o) => [o.id, o]))
  const esNueva = (l: LineaFerreteriaForm) => !guardadas.has(l.id) && !enBlanco(l)
  const campoCambiado = (l: LineaFerreteriaForm, campo: CampoLinea) => {
    const o = guardadas.get(l.id)
    return o ? o[campo] !== l[campo] : esNueva(l)
  }
  const enUso = lineas.filter((l) => !enBlanco(l))
  const ids = new Set(enUso.map((l) => l.id))
  const quitadas = foto.some((o) => !ids.has(o.id))
  return {
    esNueva,
    campoCambiado,
    hayCambios: quitadas || enUso.some((l) => esNueva(l) || CAMPOS.some((c) => campoCambiado(l, c))),
  }
}

/**
 * Id de una línea que se agrega. Nunca reutiliza el de una línea de la foto:
 * quitar la última guardada y agregar otra la haría pasar por esa misma,
 * editada, en vez de por una nueva.
 */
export function idNuevo(lineas: readonly LineaFerreteriaForm[], foto: readonly LineaFerreteriaForm[] | null): number {
  return siguienteId([...lineas, ...(foto ?? [])])
}

/**
 * Id del artículo del catálogo que ocupa la última fila, en blanco. Una fila
 * nueva conserva el suyo; una guardada que se vació, no: el artículo pasaría
 * por esa línea, editada, en vez de por una nueva (y la vaciada cuenta como
 * quitada).
 */
export function idParaFilaEnBlanco(
  fila: LineaFerreteriaForm, lineas: readonly LineaFerreteriaForm[], foto: readonly LineaFerreteriaForm[] | null,
): number {
  return foto?.some((o) => o.id === fila.id) ? idNuevo(lineas, foto) : fila.id
}
