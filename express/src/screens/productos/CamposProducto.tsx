// Los campos del formulario de un producto (anexo 6.10), los mismos al crear y al editar: nombre (con su contador N/80), precio SIN ITBIS (con el precio con ITBIS que daría), ITBIS 18 % o exento (y, si el producto
// guardado trae otro indicador, un tercer chip marcado con «*» que se conserva si no se cambia), «Es un» Servicio o Producto, la unidad y, solo al editar, «Disponible para facturar» (en lugar de borrar).
//  - El precio es un `TextField` y no un `NumericField`: ese reescribe la coma por punto antes de que `leerPrecio` pueda aplicar la regla de la coma de miles («1,250» es 1250).
//  - Un producto NUEVO no pasa de 80 caracteres en el nombre (una línea de la factura lleva 80); uno guardado se edita sin cortarse aunque ya pase de 80.
import type { UnidadMedida } from '@/api/types'
import { rd } from '~/lib/dinero'
import type { ProductoVista } from '~/lib/filas'
import { chipsItbisForm, leerPrecio, MAX_NOMBRE_PRODUCTO, precioConItbis } from '~/lib/productos'
import type { FormProducto } from '~/lib/productos'
import { Banner } from '~/ui/Banner'
import { SegmentedControl } from '~/ui/SegmentedControl'
import { TextField } from '~/ui/TextField'
import { Interruptor } from '../clientes/Interruptor'
import { SelectorUnidad } from './SelectorUnidad'
import type { ErroresProducto } from './useFormProducto'
import './Productos.css'

export function CamposProducto(p: {
  modo: 'crear' | 'editar'
  f: FormProducto
  errores: ErroresProducto
  poner<K extends keyof FormProducto>(campo: K, valor: FormProducto[K]): void
  catalogo: UnidadMedida[]
  original?: ProductoVista
  error: string | null
}): JSX.Element {
  const { modo, f, errores, poner, catalogo, original, error } = p
  const chips = chipsItbisForm(original?.indicadorFacturacion ?? null)
  const precio = leerPrecio(f.precio)
  const hayVista = precio !== null && precio > 0 && (f.indicador === 1 || f.indicador === 2)
  return (
    <div className="producto-form">
      <TextField
        etiqueta="Nombre *"
        valor={f.nombre}
        onCambio={(v) => poner('nombre', v)}
        maxLength={modo === 'crear' ? MAX_NOMBRE_PRODUCTO : undefined}
        autoCapitalize="sentences"
        autoComplete="off"
        enterkeyhint="next"
        ayuda={`${f.nombre.length}/${MAX_NOMBRE_PRODUCTO}`}
        error={errores.nombre}
      />
      <div>
        <TextField
          etiqueta="Precio sin ITBIS"
          valor={f.precio}
          onCambio={(v) => poner('precio', v)}
          modoInput="decimal"
          autoComplete="off"
          enterkeyhint="done"
          ayuda="Deja 0 si el precio cambia en cada factura"
          error={errores.precio}
        />
        {hayVista && (
          <p className="producto-form__vista tabular">
            Con ITBIS {f.indicador === 1 ? '18' : '16'}%: {rd(precioConItbis(precio, f.indicador))}
          </p>
        )}
      </div>
      <div className="producto-form__grupo">
        <span className="producto-form__etiqueta">ITBIS</span>
        <SegmentedControl
          etiquetaGrupo="ITBIS"
          opciones={chips.map((c) => ({ valor: String(c.valor), etiqueta: c.preservado ? `${c.etiqueta} *` : c.etiqueta }))}
          valor={String(f.indicador)}
          onCambio={(v) => poner('indicador', Number(v))}
        />
        {chips.some((c) => c.preservado) && <p className="producto-form__nota">* viene de la app completa; se conserva si no lo cambias</p>}
      </div>
      <div className="producto-form__grupo">
        <span className="producto-form__etiqueta">Es un</span>
        <SegmentedControl
          etiquetaGrupo="Es un"
          opciones={[
            { valor: '2', etiqueta: 'Servicio' },
            { valor: '1', etiqueta: 'Producto' },
          ]}
          valor={String(f.tipo)}
          onCambio={(v) => poner('tipo', v === '2' ? 2 : 1)}
        />
      </div>
      <SelectorUnidad valor={f.unidad} catalogo={catalogo} onCambio={(u) => poner('unidad', u)} error={errores.unidad} />
      {modo === 'editar' && <Interruptor etiqueta="Disponible para facturar" activo={f.activo} onCambio={(v) => poner('activo', v)} />}
      {error !== null && <Banner tono="danger">{error}</Banner>}
    </div>
  )
}
