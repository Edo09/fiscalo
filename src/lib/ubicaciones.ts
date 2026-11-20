// Catálogo DGII de ubicaciones (`/api/provincias-municipios`) para los selectores de provincia y municipio.
// Lo usan el perfil de un cliente y los datos de la empresa (Configuración).
import type { Ubicacion } from '@/api'

/**
 * Municipio y provincia salen del catálogo DGII (`/api/provincias-municipios`),
 * no de texto libre: lo que se persiste es el `codigo` de 6 dígitos, que es lo
 * que viaja en el XML del e-CF. Un nombre escrito a mano no lo resuelve DGII.
 *
 * Los clientes migrados de sistemas anteriores traen nombres sueltos ("SAN
 * FRANCISCO DE MACORIS"). Para no perderlos en silencio, si el valor guardado
 * no es un código conocido se intenta casar por nombre y, si tampoco, se ofrece
 * como una opción más marcada como valor actual.
 */
export function opcionesUbicacion(
  ubicaciones: Ubicacion[] | null | undefined,
  tipo: 'PROVINCIA' | 'MUNICIPIO',
  provinciaCodigo2: string,
  valorActual: string,
): Ubicacion[] {
  const todas = (ubicaciones ?? []).filter((u) => u.tipo === tipo)
  const lista = tipo === 'MUNICIPIO' && provinciaCodigo2
    ? todas.filter((u) => (u.provincia_codigo ?? '') === provinciaCodigo2)
    : todas
  const v = valorActual.trim()
  if (!v || lista.some((u) => u.codigo === v)) return lista
  // Valor heredado: si coincide con un nombre del catálogo se usa ese código.
  const porNombre = todas.find((u) => u.descripcion.toLowerCase() === v.toLowerCase())
  if (porNombre) return lista.some((u) => u.codigo === porNombre.codigo) ? lista : [porNombre, ...lista]
  return [{ tipo, codigo: v, descripcion: `${v} (valor actual)`, provincia_codigo: null }, ...lista]
}

/**
 * Código de 2 dígitos de la provincia elegida: filtra los municipios. Sale del
 * catálogo, o de los 2 primeros dígitos del código guardado como respaldo.
 */
export function codigoProvincia(ubicaciones: Ubicacion[] | null | undefined, provincia: string): string {
  return (ubicaciones ?? []).find((u) => u.tipo === 'PROVINCIA' && u.codigo === provincia)?.provincia_codigo
    ?? provincia.slice(0, 2)
}
