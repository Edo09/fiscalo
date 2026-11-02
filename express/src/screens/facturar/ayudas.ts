// Lo pequeño que comparten los pasos del asistente: esperar a que se deje de teclear, saber si una lectura va lenta y dar formato a lo que se ve.
import { useEffect, useState } from 'react'
import { LECTURA_LENTA_MS } from '~/config'

/** Espera de la búsqueda mientras se teclea en el asistente (el recorte del asistente la fija en 300 ms). */
export const DEBOUNCE_MS = 300

/** `valor` con `ms` de retraso: solo cambia cuando deja de cambiar durante ese rato. */
export function useDebounced<T>(valor: T, ms: number): T {
  const [retrasado, setRetrasado] = useState(valor)
  useEffect(() => {
    const espera = window.setTimeout(() => setRetrasado(valor), ms)
    return () => window.clearTimeout(espera)
  }, [valor, ms])
  return retrasado
}

/** ¿Lleva `activa` más de `LECTURA_LENTA_MS` seguida? Cuenta desde que se enciende y se apaga con ella; no aborta nada («Tarda más de lo normal»). */
export function useLenta(activa: boolean): boolean {
  const [lenta, setLenta] = useState(false)
  useEffect(() => {
    if (!activa) {
      setLenta(false)
      return
    }
    const espera = window.setTimeout(() => setLenta(true), LECTURA_LENTA_MS)
    return () => window.clearTimeout(espera)
  }, [activa])
  return activa && lenta
}

/** Las filas sin repetir por `id`, en su orden: con el listado cambiando entre una página y otra, una fila puede venir al final de una y al principio de la siguiente. */
export function sinRepetir<T extends { id: number }>(filas: T[]): T[] {
  const vistos = new Set<number>()
  return filas.filter((f) => {
    if (vistos.has(f.id)) return false
    vistos.add(f.id)
    return true
  })
}

/** El RNC como se lee: `131256432` es `1-31-25643-2` y la cédula `00112345678`, `001-1234567-8`. Lo que no tiene 9 u 11 dígitos se devuelve tal cual. */
export function formatearRnc(rnc: string | null): string {
  if (rnc === null) return ''
  const d = rnc.replace(/\D/g, '')
  if (d.length === 9) return `${d.slice(0, 1)}-${d.slice(1, 3)}-${d.slice(3, 8)}-${d.slice(8)}`
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 10)}-${d.slice(10)}`
  return rnc
}

/**
 * Lo que se le pregunta al servidor al buscar un cliente: lo tecleado recortado, y si es un número con guiones o espacios (un RNC pegado: «1-31-25643-2»), solo sus dígitos,
 * porque el servidor guarda los RNC sin separadores.
 */
export function consultaDeBusqueda(texto: string): string {
  const limpio = texto.trim()
  return /^[\d\s-]+$/.test(limpio) ? limpio.replace(/[\s-]/g, '') : limpio
}
