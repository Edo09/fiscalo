// La hoja de una línea (anexo 6.5): nombre, cantidad, precio SIN ITBIS, descuento en %, ITBIS (18 %, exento y la tasa propia del producto si no es de esas), tipo (bien o
// servicio) y unidad (con el selector a pantalla completa). Muestra al vuelo la base y el ITBIS de la línea, con las mismas cuentas que el servidor (`montosLinea`).
//
// Se monta al abrirse y se desmonta al cerrarse (quien la usa le pone una `key` nueva cada vez): lo que se escribe es de esa apertura. «Listo» valida con `validarLinea` (las mismas
// reglas y los mismos textos de Revisar): si algo está mal, lo dice en su campo y la hoja sigue abierta; si no, entrega la línea. Una línea libre nueva solo se agrega al guardarla,
// así que cerrar la hoja a medias no deja una línea vacía en la factura. Con el catálogo de unidades sin cargar solo se admiten cantidades enteras (lib/unidades).
import { useState } from 'react'
import { montosLinea } from '@/features/invoices/montosLinea'
import type { IndFact, LineaCarrito, TipoItem } from '~/lib/carrito'
import { MAX_NOMBRE } from '~/lib/carrito'
import { rd } from '~/lib/dinero'
import { validarLinea } from '~/lib/reglas'
import type { ErrorCampo } from '~/lib/reglas'
import { admiteDecimales, UNIDAD_POR_DEFECTO, useUnidades } from '~/lib/unidades'
import { BottomSheet } from '~/ui/BottomSheet'
import { Button } from '~/ui/Button'
import { FullScreenPicker } from '~/ui/FullScreenPicker'
import { Icon } from '~/ui/Icon'
import { SegmentedControl } from '~/ui/SegmentedControl'
import { NumericField, TextField } from '~/ui/TextField'
import './LineaSheet.css'

export type LineaNueva = Omit<LineaCarrito, 'id'>

type ModoDescuento = '0' | '5' | '10' | 'otro'

/** Un número como texto de campo: sin ceros de relleno (`5000` es «5000»). */
const comoTexto = (n: number): string => String(n)

/** El número de lo escrito en un campo numérico: vacío, o un punto suelto, vale 0 (y entonces la validación lo dice). */
function comoNumero(texto: string): number {
  const n = Number(texto)
  return texto !== '' && Number.isFinite(n) ? n : 0
}

const modoDe = (desc: number): ModoDescuento => (desc === 0 ? '0' : desc === 5 ? '5' : desc === 10 ? '10' : 'otro')

const DESCUENTOS: { valor: ModoDescuento; etiqueta: string }[] = [
  { valor: '0', etiqueta: '0%' },
  { valor: '5', etiqueta: '5%' },
  { valor: '10', etiqueta: '10%' },
  { valor: 'otro', etiqueta: 'Otro' },
]

const TIPOS: { valor: string; etiqueta: string }[] = [
  { valor: '1', etiqueta: 'Bien' },
  { valor: '2', etiqueta: 'Servicio' },
]

export function LineaSheet(p: { titulo: string; inicial: LineaNueva; existente: boolean; onListo(l: LineaNueva): void; onQuitar(): void; onCerrar(): void }): JSX.Element {
  const { titulo, inicial, existente, onListo, onQuitar, onCerrar } = p
  const { catalogo } = useUnidades()
  const [nombre, setNombre] = useState(inicial.nombre)
  const [cantidad, setCantidad] = useState(comoTexto(inicial.cant))
  const [precio, setPrecio] = useState(inicial.precio === 0 ? '' : comoTexto(inicial.precio))
  const [modo, setModo] = useState<ModoDescuento>(modoDe(inicial.desc))
  const [otroDescuento, setOtroDescuento] = useState(modoDe(inicial.desc) === 'otro' ? comoTexto(inicial.desc) : '')
  const [indFact, setIndFact] = useState<IndFact>(inicial.indFact)
  const [tipoItem, setTipoItem] = useState<TipoItem>(inicial.tipoItem)
  const [unidad, setUnidad] = useState(inicial.unidad)
  const [intento, setIntento] = useState(false)
  const [eligiendoUnidad, setEligiendoUnidad] = useState(false)
  const [busquedaUnidad, setBusquedaUnidad] = useState('')

  const desc = modo === 'otro' ? comoNumero(otroDescuento) : Number(modo)
  const linea: LineaCarrito = { id: 0, nombre, cant: comoNumero(cantidad), precio: comoNumero(precio), desc, indFact, tipoItem, unidad }
  const admite = admiteDecimales(unidad, catalogo)
  const errores: ErrorCampo[] = validarLinea(linea, admite)
  if (catalogo.length > 0 && !catalogo.some((x) => String(x.id) === unidad)) errores.push({ campo: 'unidad', mensaje: 'Elige la unidad de medida de esta línea.' })
  const de = (campo: ErrorCampo['campo']): string | undefined => (intento ? errores.find((e) => e.campo === campo)?.mensaje : undefined)

  const montos = montosLinea({ cant: linea.cant, precio: linea.precio, desc: linea.desc, indFact }, false)
  const unidadActual = catalogo.find((x) => String(x.id) === unidad)?.descripcion ?? (unidad === UNIDAD_POR_DEFECTO ? 'Unidad' : `Código ${unidad}`)
  // El ITBIS: 18 % y exento siempre; la tasa propia del producto (16 % o tasa cero) aparece como una tercera opción y se conserva.
  const opcionesItbis = [
    { valor: '1', etiqueta: '18%' },
    ...(indFact === 2 ? [{ valor: '2', etiqueta: '16%' }] : []),
    ...(indFact === 3 ? [{ valor: '3', etiqueta: 'Tasa 0' }] : []),
    { valor: '4', etiqueta: 'Exento' },
  ]
  const buscadas = busquedaUnidad.trim().toLowerCase()
  const unidades = catalogo.filter((x) => buscadas === '' || x.descripcion.toLowerCase().includes(buscadas) || String(x.id) === buscadas)

  const listo = (): void => {
    if (errores.length > 0) {
      setIntento(true)
      return
    }
    const l: LineaNueva = { nombre: nombre.trim(), cant: linea.cant, precio: linea.precio, desc, indFact, tipoItem, unidad }
    if (inicial.descripcion !== undefined) l.descripcion = inicial.descripcion
    if (inicial.productoId !== undefined) l.productoId = inicial.productoId
    onListo(l)
  }

  return (
    <>
      <BottomSheet
        abierto
        titulo={titulo}
        onCerrar={onCerrar}
        pie={
          <>
            <Button bloque onClick={listo}>
              Listo
            </Button>
            {existente && (
              <Button variante="texto" bloque onClick={onQuitar}>
                Quitar línea
              </Button>
            )}
          </>
        }
      >
        <div className="ls">
          <TextField etiqueta="Nombre" valor={nombre} onCambio={setNombre} error={de('nombre')} ayuda={`${nombre.length}/${MAX_NOMBRE}`} autoCapitalize="sentences" autoComplete="off" enterkeyhint="next" />
          <div className="ls__par">
            <NumericField etiqueta="Cantidad" valor={cantidad} onCambio={setCantidad} decimales={admite ? 2 : 0} error={de('cant')} enterkeyhint="next" />
            <NumericField etiqueta="Precio sin ITBIS" valor={precio} onCambio={setPrecio} decimales={4} error={de('precio')} enterkeyhint="done" />
          </div>

          <div className="ls__grupo">
            <p className="ls__etiqueta">Descuento</p>
            <SegmentedControl etiquetaGrupo="Descuento" opciones={DESCUENTOS} valor={modo} onCambio={(v) => setModo(v)} />
            {modo === 'otro' && <NumericField etiqueta="Descuento en %" valor={otroDescuento} onCambio={setOtroDescuento} decimales={2} error={de('desc')} enterkeyhint="done" />}
          </div>

          <div className="ls__grupo">
            <p className="ls__etiqueta">ITBIS</p>
            <SegmentedControl etiquetaGrupo="ITBIS" opciones={opcionesItbis} valor={String(indFact)} onCambio={(v) => setIndFact(Number(v) as IndFact)} />
          </div>

          <div className="ls__grupo">
            <p className="ls__etiqueta">Tipo</p>
            <SegmentedControl etiquetaGrupo="Tipo" opciones={TIPOS} valor={String(tipoItem)} onCambio={(v) => setTipoItem(Number(v) as TipoItem)} />
          </div>

          <div className="ls__grupo">
            <p className="ls__etiqueta">Unidad de medida</p>
            <button type="button" className="ls__unidad" onClick={() => setEligiendoUnidad(true)}>
              <span>{unidadActual}</span>
              <Icon name="chevron-right" />
            </button>
            {de('unidad') !== undefined && (
              <p className="ls__error" role="alert">
                {de('unidad')}
              </p>
            )}
          </div>

          <div className="ls__montos" aria-live="polite">
            <span>Base {rd(montos.base)}</span>
            <span>ITBIS {rd(montos.itbis)}</span>
          </div>
        </div>
      </BottomSheet>

      <FullScreenPicker
        abierto={eligiendoUnidad}
        titulo="Elegir unidad de medida"
        placeholderBusqueda="Buscar unidad"
        busqueda={busquedaUnidad}
        onBusqueda={setBusquedaUnidad}
        onCerrar={() => {
          setEligiendoUnidad(false)
          setBusquedaUnidad('')
        }}
      >
        {catalogo.length === 0 ? (
          <p className="ls__vacio">Cargando las unidades de medida… Mientras tanto se usa «Unidad».</p>
        ) : unidades.length === 0 ? (
          <p className="ls__vacio">Sin resultados para «{busquedaUnidad.trim()}».</p>
        ) : (
          <ul className="ls__unidades">
            {unidades.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  className="ls__opcion"
                  aria-pressed={String(x.id) === unidad}
                  onClick={() => {
                    setUnidad(String(x.id))
                    setEligiendoUnidad(false)
                    setBusquedaUnidad('')
                  }}
                >
                  <span>{x.descripcion}</span>
                  {String(x.id) === unidad && <Icon name="check" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </FullScreenPicker>
    </>
  )
}
