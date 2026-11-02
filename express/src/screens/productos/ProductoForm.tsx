// Editar producto (anexo 6.10, `#/productos/:id`): el formulario de un producto guardado, a pantalla completa, con «Guardar» pegado sobre el teclado. Se pide con GET /api/products?id= y el formulario solo se arma
// cuando llegó. Un 404 (lo borraron en otro sitio) dice «Este producto ya no existe» y reemplaza la ruta por la lista; cualquier otro fallo, «Reintentar».
// «Guardar» solo se habilita con cambios y manda SOLO lo cambiado sobre la fila fresca (lib/productos `fusionarProducto`): el producto que viene de la app completa no pierde su SKU, su costo, su existencia ni sus
// otros precios. «Disponible para facturar» apagado lo saca de las ventas sin borrarlo.
import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/api/errores'
import { normalizarProducto } from '~/lib/filas'
import type { ProductoVista } from '~/lib/filas'
import { useEnLinea } from '~/net/enLinea'
import { claves, leerProducto } from '~/net/productos'
import { atras, navegar } from '~/router'
import type { Ruta } from '~/router'
import { Banner } from '~/ui/Banner'
import { Button } from '~/ui/Button'
import { Cabecera } from '~/ui/Cabecera'
import { Skeleton } from '~/ui/Skeleton'
import { StickyActionBar } from '~/ui/StickyActionBar'
import { mostrarToast } from '~/ui/Toast'
import { CamposProducto } from './CamposProducto'
import { useFormProducto } from './useFormProducto'
import './Productos.css'

/** El formulario con el producto ya cargado: el estado del formulario nace de él una vez (por eso es un componente aparte). */
function Edicion(p: { original: ProductoVista }): JSX.Element {
  const enLinea = useEnLinea()
  const form = useFormProducto({ original: p.original, onGuardado: () => atras({ id: 'productos' }) })
  return (
    <>
      <div className="producto__cuerpo">
        <CamposProducto modo="editar" f={form.f} errores={form.errores} poner={form.poner} catalogo={form.catalogo} original={p.original} error={form.error} />
      </div>
      <StickyActionBar>
        <Button
          bloque
          cargando={form.guardando}
          disabled={!form.puedeGuardar || !enLinea}
          razon={!enLinea ? 'Sin conexión: no puedes guardar ahora.' : 'No hay cambios que guardar.'}
          onClick={() => void form.guardar()}
        >
          Guardar
        </Button>
      </StickyActionBar>
    </>
  )
}

export default function ProductoForm(p: { ruta: Ruta }): JSX.Element {
  const id = p.ruta.id === 'producto' ? p.ruta.productoId : 0
  const q = useQuery({
    queryKey: claves.item(id),
    queryFn: () => leerProducto(id),
    enabled: id > 0,
    // Un 404 es una respuesta, no un fallo de la red: no se repite.
    retry: (veces, e) => !(e instanceof ApiError && e.status === 404) && veces < 1,
  })
  const noExiste = q.error instanceof ApiError && q.error.status === 404
  useEffect(() => {
    if (!noExiste) return
    mostrarToast('Este producto ya no existe', { tipo: 'error' })
    navegar({ id: 'productos' }, { reemplazar: true })
  }, [noExiste])

  const original = useMemo(() => (q.data === undefined ? null : normalizarProducto(q.data)), [q.data])

  return (
    <div className="pantalla">
      <Cabecera titulo="Editar producto" atras={{ id: 'productos' }} />
      {original !== null ? (
        <Edicion key={original.id} original={original} />
      ) : (
        <div className="producto__cuerpo">
          {q.isError && !noExiste ? (
            <Banner tono="danger" accion={{ etiqueta: 'Reintentar', onClick: () => void q.refetch() }}>
              No se pudo cargar el producto.
            </Banner>
          ) : (
            <div aria-busy="true">
              <Skeleton filas={4} alto={72} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
