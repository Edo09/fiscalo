// El estado y el guardado del formulario de un producto, para sus dos sitios: la hoja «Nuevo producto» sobre la lista (sin `original`) y la pantalla de edición (con el producto guardado). Los dos dibujan
// los mismos campos (CamposProducto) y se diferencian en dónde va el botón «Guardar».
//  - Los errores de cada campo salen tras el primer intento de guardar (un campo a medio escribir no se marca en rojo).
//  - Crear: `payloadCrear` por `crearProducto` (que no se repite solo y, si la respuesta se perdió, busca el producto antes de dejar reintentar). Editar: SOLO los cambios, que `guardarCambios` pone sobre la fila fresca
//    (el PUT del servidor pisa lo que no viaja). Un fallo se dice con el texto del servidor y se puede volver a tocar «Guardar».
//  - `sucio` es «hay algo que se perdería al cerrar»: en un producto nuevo, algo escrito; en uno guardado, algún cambio.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errores'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { cambiosProducto, formDesdeProducto, formNuevoProducto, mensajeGuardarProducto, payloadCrear, validarFormProducto } from '~/lib/productos'
import type { FormProducto } from '~/lib/productos'
import type { ProductoVista } from '~/lib/filas'
import { useUnidades } from '~/lib/unidades'
import { claves, crearProducto, guardarCambios } from '~/net/productos'
import { mostrarToast } from '~/ui/Toast'

export type ErroresProducto = Partial<Record<keyof FormProducto, string>>

export interface FormularioProducto {
  f: FormProducto
  poner<K extends keyof FormProducto>(campo: K, valor: FormProducto[K]): void
  errores: ErroresProducto
  /** En uno guardado, hay algo que guardar; en uno nuevo siempre se puede intentar. */
  puedeGuardar: boolean
  sucio: boolean
  guardando: boolean
  error: string | null
  guardar(): Promise<void>
  catalogo: ReturnType<typeof useUnidades>['catalogo']
}

export function useFormProducto(o: { original?: ProductoVista; nombreInicial?: string; onGuardado(): void }): FormularioProducto {
  const { original, nombreInicial, onGuardado } = o
  const { catalogo } = useUnidades()
  const cliente = useQueryClient()
  const [f, setF] = useState<FormProducto>(() => (original !== undefined ? formDesdeProducto(original) : formNuevoProducto(nombreInicial ?? '')))
  const [base] = useState(() => JSON.stringify(f))
  const [intento, setIntento] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const errores = validarFormProducto(f, catalogo, original)
  const hayErrores = Object.keys(errores).length > 0
  const cambios = original === undefined ? null : cambiosProducto(original, f)
  const hayCambios = cambios !== null && Object.keys(cambios).length > 0
  const sucio = original === undefined ? JSON.stringify(f) !== base : hayCambios

  const guardar = useAccionUnica(async () => {
    setIntento(true)
    if (hayErrores) return
    if (original !== undefined && !hayCambios) return
    setError(null)
    setGuardando(true)
    try {
      if (original === undefined) {
        const r = await crearProducto(payloadCrear(f))
        if (r.kind === 'fallo') {
          setError(r.mensaje)
          return
        }
      } else if (cambios !== null) {
        await guardarCambios(original.id, cambios)
      }
      void cliente.invalidateQueries({ queryKey: claves.todos })
      mostrarToast(original === undefined ? 'Producto guardado' : 'Cambios guardados', { tipo: 'ok' })
      onGuardado()
    } catch (e) {
      if (!(e instanceof ApiError)) console.error('[productos] guardar', e) // lo que no es del API no se le enseña a nadie, pero queda en la consola
      setError(mensajeGuardarProducto(e))
    } finally {
      setGuardando(false)
    }
  })

  return {
    f,
    poner: (campo, valor) => setF((a) => ({ ...a, [campo]: valor })),
    errores: intento ? errores : {},
    puedeGuardar: original === undefined || hayCambios,
    sucio,
    guardando,
    error,
    guardar,
    catalogo,
  }
}
