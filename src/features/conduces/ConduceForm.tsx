import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Icon, Btn } from '@/components/ui'
import { ApiError, createConduce, updateConduce, deleteConduce, previewConduce, getBranding, getEmisor } from '@/api'
import type { ConduceInput } from '@/api'
import { NewClientModal } from '@/features/clients/NewClientModal'
import { ProductoCombobox } from '@/features/products/ProductoCombobox'
import { UnidadMedidaSelect } from '@/components/UnidadMedidaSelect'
import {
  MSG_UNIDAD, admiteDecimales, problemaCantidad, unidadValida, useUnidadesMedida,
} from '@/components/unidadesMedida'
import { BloqueCliente } from '@/features/cotizaciones/formatos/ferreteria/BloqueCliente'
import { DescripcionLinea } from '@/features/cotizaciones/formatos/ferreteria/DescripcionLinea'
import {
  formatearRnc, lineaDesdeProducto, lineaLibre, siguienteId,
} from '@/features/cotizaciones/formatos/ferreteria/lineas'
import { MAX_DESCRIPCION, type LineaFerreteriaForm } from '@/features/cotizaciones/formatos/ferreteria/schema'
import { presentDocument } from '@/lib/file'
import { ahoraLocal } from '@/lib/date'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { useAvisoSalida } from '@/hooks/useAvisoSalida'
import type { Nav } from '@/config/navigation'
import type { Cliente, Producto } from '@/types/domain'
import {
  MSG_CLIENTE_BORRADO, conduceFormSchema, confirmacionEliminar, cuerpoConduce, lineaVacia, mapearErroresConduce,
  sinErroresConduce, type ErroresConduce,
} from './schema'
import '@/styles/factura-doc.css'

/* FISCALO — Conduce de mercancía de Ferretería (spec conduces 5.5).

   El papel que va con la mercancía y que el cliente firma: el de la cotización
   de Ferretería sin precios. Cada línea (del catálogo o libre) lleva cantidad,
   unidad y descripción; el precio, el ITBIS y bien/servicio viajan por dentro
   para Facturar desde el conduce, y nunca se muestran ni se imprimen.

   Este componente es solo el formulario: ConduceEditor lo monta cuando ya sabe
   qué documento es (nuevo desde una cotización, nuevo en blanco sin cotización,
   o uno guardado) y quién es el cliente, con todo en `inicial`. App le pone una
   key por documento, así que `inicial` no cambia mientras está montado. */

/** Lo que el editor sabe del conduce al abrirlo. */
export interface InicialConduce {
  /** null = conduce nuevo (de `cotizacionId`, o en blanco si ese también es null). */
  conduceId: number | null
  /**
   * Cotización de origen al crear: el POST la manda si hay una. null al crear =
   * un conduce sin cotización (el cuerpo no lleva `cotizacion_id`); al editar
   * siempre null (el PUT la ignora).
   */
  cotizacionId: number | null
  /** CON-000001, o '' si todavía no se guardó. */
  codigo: string
  /** Código de la cotización de origen para el encabezado; null = sin cotización (nació sin ella, o se eliminó). */
  cotizacionCodigo: string | null
  /** 'YYYY-MM-DD' del campo de fecha. */
  fecha: string
  /** Día guardado ('' al crear). Si no se cambia, el PUT no manda fecha y se conserva la hora. */
  fechaGuardada: string
  lineas: LineaFerreteriaForm[]
  cliente: Cliente | null
  /** false = ficha provisional (no se pudo leer el cliente completo: falta su RNC). */
  clienteCompleto: boolean
  /** El cliente del documento ya no existe: el formulario abre sin cliente y lo dice. */
  clienteBorrado: boolean
  /** Cargos de la cotización que no pasan al conduce (solo al crear con cotización); null = no tenía, o no hay cotización. */
  avisoCargos: string | null
}

/**
 * Lo que cuenta como "cambio", en una sola cadena: se compara con la foto que
 * se toma al abrir. Si el usuario devuelve un campo a como estaba, deja de contar.
 */
function huella(clienteId: string | null, libre: string, fecha: string, lineas: LineaFerreteriaForm[]): string {
  return JSON.stringify([
    clienteId, libre.trim(), fecha,
    lineas.map((l) => [l.prodId, l.descripcion, l.cantidad, l.precio, l.indFact, l.unidadMedida, l.tipoItem]),
  ])
}

export function ConduceForm({ nav, inicial }: { nav: Nav; inicial: InicialConduce }) {
  const queryClient = useQueryClient()
  const { conduceId, cotizacionId, codigo, fechaGuardada } = inicial
  const editando = conduceId != null
  // Solo un conduce nuevo que sale de una cotización vuelve a Cotizaciones; uno
  // guardado o uno en blanco (sin cotización) vuelven a Conduces.
  const desdeCotizacion = !editando && cotizacionId != null

  const [cliente, setCliente] = useState<Cliente | null>(inicial.cliente)
  /** false mientras el cliente es la ficha provisional (sin su RNC). */
  const [clienteCompleto, setClienteCompleto] = useState(inicial.clienteCompleto)
  /** El cliente guardado se borró; se apaga al elegir otro. */
  const [clienteBorrado, setClienteBorrado] = useState(inicial.clienteBorrado)
  /** Nombre escrito a mano (NombreClienteLibre) que todavía no se guardó como cliente. */
  const [clienteLibre, setClienteLibre] = useState('')
  /** Lo escrito en el buscador de clientes sin elegir un resultado. */
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [nuevoCliente, setNuevoCliente] = useState(false)
  const [fecha, setFecha] = useState(inicial.fecha)
  const [lineas, setLineas] = useState<LineaFerreteriaForm[]>(inicial.lineas)
  const [errores, setErrores] = useState<ErroresConduce>(sinErroresConduce)
  const [guardando, setGuardando] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [borrando, setBorrando] = useState(false)
  /** Foto del documento tal como se abrió (ver huella). */
  const [original] = useState(() => huella(inicial.cliente?.id ?? null, '', inicial.fecha, inicial.lineas))

  // --- Emisor: el membrete del papel, igual que en la cotización ---
  const { data: emisor } = useApiQuery(['emisor'], getEmisor)
  const { data: branding } = useApiQuery(['branding'], getBranding)
  const emisorNombre = emisor?.nombre_comercial || emisor?.razon_social || ''
  const contactoEmisor = [emisor?.telefono, emisor?.correo].filter(Boolean).join(' · ')
  // Qué unidades admiten fracciones (metro, kilo) y cuáles se cuentan enteras.
  const unidades = useUnidadesMedida()

  /** Las líneas que se guardan: las filas vacías se descartan sin avisar (ver lineaVacia). */
  const enUso = lineas.filter((l) => !lineaVacia(l))
  // Nuevo o guardado, se avisa al salir solo si se tocó algo: un conduce nuevo
  // abre con lo de su cotización (se recupera con volver a pulsar Conduce) o en
  // blanco, y sin tocar nada no hay qué perder.
  const hayCambios = huella(cliente?.id ?? null, clienteLibre, fecha, lineas) !== original
  const salida = useAvisoSalida(
    hayCambios,
    editando
      ? `Los cambios del conduce ${codigo} no se han guardado. Si sales ahora, se pierden.`
      : 'Este conduce no se ha guardado: no tiene número y no aparecerá en el listado. Si sales ahora, se pierden tus cambios.',
    // Mientras se guarda o se borra no se pregunta: la navegación espera.
    guardando || borrando,
  )
  // Uno nuevo desde una cotización sale de Cotizaciones; uno guardado o uno en
  // blanco, de Conduces: Cancelar vuelve allí.
  const volver = () => nav(desdeCotizacion ? 'cotizaciones' : 'conduces')

  // --- Cliente ---
  const quitarErrCliente = () => setErrores((e) => (e.cliente ? { ...e, cliente: undefined } : e))
  const seleccionarCliente = (c: Cliente | null) => {
    setCliente(c)
    setClienteCompleto(true)
    setClienteBorrado(false)
    // El nombre libre ya no aplica: o se eligió un cliente, o se va a buscar otro.
    setClienteLibre('')
    quitarErrCliente()
  }

  // --- Líneas ---
  const quitarErrLinea = (id: number) =>
    setErrores((e) => {
      if (!(id in e.lineas)) return e
      const ls = { ...e.lineas }
      delete ls[id]
      return { ...e, lineas: ls }
    })
  const quitarErrForm = () => setErrores((e) => (e.form ? { ...e, form: undefined } : e))
  const updLinea = (id: number, cambio: Partial<LineaFerreteriaForm>) => {
    setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...cambio } : l)))
    quitarErrLinea(id)
  }
  const delLinea = (id: number) => {
    setLineas((ls) => ls.filter((l) => l.id !== id))
    quitarErrLinea(id)
  }
  /** Línea libre: precio interno 0, 18%, Unidad y bien (lineaLibre). */
  const addLineaLibre = () => {
    setLineas((ls) => [...ls, lineaLibre(siguienteId(ls))])
    quitarErrForm()
  }
  /**
   * Artículo del catálogo: su nombre y su unidad a la vista; su precio SIN
   * ITBIS, su tasa y si es bien o servicio, por dentro. Si la última fila sigue
   * vacía se reemplaza, para no dejar huecos.
   */
  const addProducto = (p: Producto) => {
    setLineas((ls) => {
      const ultima = ls[ls.length - 1]
      return ultima && lineaVacia(ultima)
        ? [...ls.slice(0, -1), lineaDesdeProducto(p, ultima.id)]
        : [...ls, lineaDesdeProducto(p, siguienteId(ls))]
    })
    quitarErrForm()
  }

  /**
   * Valida con conduceFormSchema y arma el cuerpo del API. Pinta los errores
   * junto a cada campo y resume cuántos hay. null = hay algo que corregir.
   */
  const validar = (): ConduceInput | null => {
    const res = conduceFormSchema({
      problemaCantidad: (c, u) => problemaCantidad(c, { unidadId: u, catalogo: unidades, maxDecimales: 2 }),
      problemaUnidad: (u) => (unidadValida(u, unidades) ? null : MSG_UNIDAD),
    }).safeParse({
      cliente,
      clienteEscrito: { buscador: cliente ? '' : busquedaCliente, libre: cliente ? '' : clienteLibre.trim() },
      fecha,
      lineas: enUso,
    })
    if (!res.success) {
      setErrores(mapearErroresConduce(res.error, enUso))
      const n = res.error.issues.length
      toast.error(n === 1 ? 'Revisa 1 campo del conduce.' : `Revisa ${n} campos del conduce.`)
      return null
    }
    if (!cliente) return null
    setErrores(sinErroresConduce())
    // Nuevo: el día elegido con la hora de ahora. Editando, la fecha solo
    // viaja si se cambió el día; si no, el backend conserva la fecha y la hora.
    const date = editando && fecha === fechaGuardada ? undefined : `${fecha} ${ahoraLocal().slice(11)}`
    return cuerpoConduce({ clienteId: Number(cliente.id), lineas: enUso, cotizacionId: editando ? null : cotizacionId, date })
  }

  // Acción única: un doble clic crearía el mismo conduce dos veces (y gastaría dos números).
  const guardar = useAccionUnica(async () => {
    const cuerpo = validar()
    if (!cuerpo) return
    setGuardando(true)
    try {
      if (conduceId != null) {
        await updateConduce({ ...cuerpo, id: conduceId })
        toast.success(`Conduce ${codigo} actualizado.`)
      } else {
        const res = await createConduce(cuerpo)
        toast.success(`Conduce ${res.code} creado.`)
      }
      void queryClient.invalidateQueries({ queryKey: ['conduces'] })
      salida.liberar()
      nav('conduces', null, { replace: true })
    } catch (e) {
      // Los 422 del servidor dicen qué línea falla: se muestran tal cual.
      toast.error(e instanceof ApiError ? e.message : 'No se pudo guardar el conduce.')
      setGuardando(false)
    }
  })

  const vistaPrevia = async () => {
    const cuerpo = validar()
    if (!cuerpo) return
    setPreviewing(true)
    const tid = toast.loading('Generando vista previa…')
    try {
      // Editando viaja el id: el PDF sale con el número y la cotización de ese conduce.
      presentDocument(await previewConduce(conduceId != null ? { ...cuerpo, id: conduceId } : cuerpo))
      toast.success('Vista previa generada.', { id: tid })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo generar la vista previa.', { id: tid })
    } finally {
      setPreviewing(false)
    }
  }

  // Eliminar desactiva el conduce (activo = 0): no se borra nada y el número no vuelve a salir.
  const borrar = useAccionUnica(async () => {
    if (conduceId == null) return
    setBorrando(true)
    try {
      await deleteConduce(conduceId)
      void queryClient.invalidateQueries({ queryKey: ['conduces'] })
      toast.success(`Conduce ${codigo} eliminado.`)
      salida.liberar()
      nav('conduces', null, { replace: true })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo eliminar el conduce.')
      setBorrando(false)
    }
  })

  return (
    <div className="page fx-desk">
      <div className="row between" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
        <Btn variant="secondary" size="sm" icon="arrow-left" onClick={volver}>
          {desdeCotizacion ? 'Cotizaciones' : 'Conduces'}
        </Btn>
        {editando && confirmDel ? (
          <span className="row gap-sm" style={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span className="text-sm muted">{confirmacionEliminar(codigo)}</span>
            <Btn variant="ghost" size="sm" onClick={() => setConfirmDel(false)}>No</Btn>
            <Btn variant="danger" size="sm" onClick={() => void borrar()} disabled={borrando}>
              {borrando ? 'Eliminando…' : 'Sí, eliminar'}
            </Btn>
          </span>
        ) : editando ? (
          <Btn variant="ghost" size="sm" icon="trash-2" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDel(true)}>
            Eliminar
          </Btn>
        ) : inicial.avisoCargos ? (
          // Los cargos no se copian: se dice al abrir, donde la factura dice los suyos.
          <span className="row gap-sm text-xs" style={{ color: 'var(--warning)', maxWidth: 560, textAlign: 'right' }}>
            <Icon name="alert-triangle" size={13} />
            {inicial.avisoCargos}
          </span>
        ) : null}
      </div>

      <article className="fx-sheet">
        {/* --- Emisor + identificación del documento --- */}
        <header className="fx-head">
          <div>
            {branding?.logo_data_uri && <img className="fx-logo" src={branding.logo_data_uri} alt="" />}
            <div className="fx-emisor-name">{emisorNombre || 'Tu empresa'}</div>
            {emisor?.direccion && <div className="fx-emisor-line">{emisor.direccion}</div>}
            {contactoEmisor && <div className="fx-emisor-line">{contactoEmisor}</div>}
            {emisor?.rnc && <div className="fx-emisor-line">RNC {formatearRnc(emisor.rnc)}</div>}
          </div>

          <div className="fx-meta">
            <span className="fx-eyebrow">Entrega de mercancía</span>
            <div className="fx-tipo-fijo">Conduce de mercancía</div>
            <span className={'fx-numero' + (codigo ? '' : ' fx-numero-pend')}>
              {codigo || 'Se asigna al guardar'}
            </span>
            <span className="fx-aviso fx-aviso--suave">
              {inicial.cotizacionCodigo ? `Desde la cotización ${inicial.cotizacionCodigo}` : 'Sin cotización'}
            </span>
            <label className="fx-eyebrow" htmlFor="fx-con-fecha">Fecha</label>
            <input
              id="fx-con-fecha"
              className={'fx-field' + (errores.fecha ? ' fx-field--err' : '')}
              type="date"
              value={fecha}
              onChange={(e) => {
                setFecha(e.target.value)
                if (errores.fecha) setErrores((er) => ({ ...er, fecha: undefined }))
              }}
              style={{ textAlign: 'right', width: 'auto' }}
              aria-invalid={errores.fecha ? true : undefined}
            />
            {errores.fecha && <span className="fx-err"><Icon name="alert-circle" size={12} />{errores.fecha}</span>}
          </div>
        </header>

        <div className="fx-rule" />

        {/* --- Cliente: el mismo bloque que la cotización --- */}
        <BloqueCliente
          cliente={cliente}
          clienteCompleto={clienteCompleto}
          clienteLibre={clienteLibre}
          // El cliente borrado se dice en el mismo sitio que un error del campo, hasta elegir otro.
          error={errores.cliente ?? (clienteBorrado ? MSG_CLIENTE_BORRADO : undefined)}
          avisoSinDoc="Este cliente no tiene RNC ni cédula: el conduce sale sin ese dato."
          onSeleccionar={seleccionarCliente}
          onBusquedaChange={(texto) => { setBusquedaCliente(texto); quitarErrCliente() }}
          onLibreChange={(v) => { setClienteLibre(v); quitarErrCliente() }}
          onNuevoCliente={() => setNuevoCliente(true)}
        />

        {/* --- Líneas: cantidad, unidad y descripción; los montos no se ven --- */}
        <section className="fx-items" style={{ marginTop: 24 }}>
          <div className="fx-grid-ecf fx-grid-conduce fx-items-head">
            <span />
            <span style={{ textAlign: 'right' }}>Cant.</span>
            <span>Unidad</span>
            <span>Descripción</span>
          </div>

          {lineas.map((l, i) => {
            const le = errores.lineas[l.id]
            // Paso y teclado según la unidad: metros o kilos admiten
            // fracciones; unidades o cajas se cuentan enteras.
            const enteras = !admiteDecimales(l.unidadMedida, unidades)
            return (
              <div className={'fx-grid-ecf fx-grid-conduce fx-row' + (le ? ' fx-row-incompleta' : '')} key={l.id}>
                <button
                  type="button"
                  className="fx-gutter"
                  onClick={() => delLinea(l.id)}
                  aria-label={`Quitar línea ${i + 1}`}
                  title="Quitar línea"
                >
                  <Icon name="x" size={14} />
                </button>

                <div className="fx-cell" data-label="Cant.">
                  <input
                    className={'fx-field fx-num' + (le?.cantidad ? ' fx-field--err' : '')}
                    type="number" min={0}
                    step={enteras ? 1 : 'any'}
                    inputMode={enteras ? 'numeric' : 'decimal'}
                    value={l.cantidad}
                    onChange={(e) => updLinea(l.id, { cantidad: +e.target.value || 0 })}
                    aria-label={`Cantidad de la línea ${i + 1}`}
                    aria-invalid={le?.cantidad ? true : undefined}
                  />
                  {le?.cantidad && <span className="fx-err">{le.cantidad}</span>}
                </div>

                <div className="fx-cell" data-label="Unidad">
                  <UnidadMedidaSelect
                    className={'fx-tasa' + (le?.unidadMedida ? ' fx-tasa--err' : '')}
                    value={l.unidadMedida}
                    onChange={(v) => updLinea(l.id, { unidadMedida: v })}
                  />
                  {le?.unidadMedida && <span className="fx-err">{le.unidadMedida}</span>}
                </div>

                <div className="fx-desc">
                  <DescripcionLinea
                    className={'fx-field fx-desc' + (le?.descripcion ? ' fx-field--err' : '')}
                    value={l.descripcion}
                    onValue={(v) => updLinea(l.id, { descripcion: v })}
                    placeholder="Lo que se entrega (ej. Fundas de cemento gris)"
                    aria-label={`Descripción de la línea ${i + 1}`}
                    aria-invalid={le?.descripcion ? true : undefined}
                  />
                  {le?.descripcion && <span className="fx-err"><Icon name="alert-circle" size={12} />{le.descripcion}</span>}
                  <div className="fx-linea-pie">
                    {/* Ligada al catálogo = al facturar el conduce descuenta inventario. */}
                    {l.prodId ? (
                      <span className="fx-contador">Del catálogo · {l.tipoItem}</span>
                    ) : (
                      <>
                        <span className="fx-contador">Línea libre ·</span>
                        <button
                          type="button"
                          className="fx-detalle-toggle fx-detalle-toggle--sec"
                          onClick={() => updLinea(l.id, { tipoItem: l.tipoItem === 'Bien' ? 'Servicio' : 'Bien' })}
                          title="Cambiar entre bien y servicio (cuenta al facturarla)"
                        >
                          {l.tipoItem}
                        </button>
                      </>
                    )}
                    {l.descripcion.trim().length > MAX_DESCRIPCION - 100 && (
                      <span className={'fx-contador' + (l.descripcion.trim().length > MAX_DESCRIPCION ? ' fx-contador--tope' : '')}>
                        {l.descripcion.trim().length}/{MAX_DESCRIPCION}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {lineas.length === 0 && (
            <div className="state" style={{ padding: 26 }}>
              <span className="text-sm" style={{ color: errores.form ? 'var(--danger)' : 'var(--text-2)' }}>
                {errores.form ?? 'Sin líneas. Busca un artículo del catálogo o agrega una línea libre.'}
              </span>
            </div>
          )}

          <div className="fx-add-row">
            <div className="fx-buscar-prod">
              <ProductoCombobox ocultarMonto onSelect={addProducto} placeholder="Agregar del catálogo: nombre, SKU o categoría…" />
            </div>
            <button type="button" className="fx-add" onClick={addLineaLibre}>
              <Icon name="plus" size={14} />Línea libre
            </button>
          </div>

          {errores.form && lineas.length > 0 && (
            <span className="fx-err" style={{ marginTop: 10 }}>
              <Icon name="alert-circle" size={12} />{errores.form}
            </span>
          )}
        </section>

        <footer className="fx-nota">
          El conduce no muestra precios: cada línea guarda el suyo para facturar · el número lo asigna el sistema
          al guardar y no se vuelve a usar
        </footer>
      </article>

      {/* --- Acciones (fuera del papel) --- */}
      <div className="fx-bar">
        <div className="fx-bar-total">
          {hayCambios ? (
            <span className="fx-cambios">Cambios sin guardar</span>
          ) : (
            <span className="text-sm muted">
              {enUso.length === 0 ? 'Sin líneas todavía' : `${enUso.length} ${enUso.length === 1 ? 'línea' : 'líneas'}`}
            </span>
          )}
        </div>
        <div className="row gap-sm fx-acciones">
          <Btn variant="ghost" onClick={volver}>Cancelar</Btn>
          <Btn variant="secondary" icon="eye" onClick={() => void vistaPrevia()} disabled={previewing}>
            {previewing ? 'Generando…' : 'Vista previa'}
          </Btn>
          <Btn variant="primary" icon="save" onClick={() => void guardar()} disabled={guardando || borrando}>
            {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear conduce'}
          </Btn>
        </div>
      </div>

      {/* Fuera del papel: dentro, .fx-sheet recortaría el modal (ver BloqueCliente). */}
      {nuevoCliente && (
        <NewClientModal
          // Lo que ya escribió (como nombre libre o en el buscador) no se vuelve a teclear.
          nombreInicial={clienteLibre.trim() || busquedaCliente}
          onClose={() => setNuevoCliente(false)}
          onCreated={seleccionarCliente}
        />
      )}
    </div>
  )
}
