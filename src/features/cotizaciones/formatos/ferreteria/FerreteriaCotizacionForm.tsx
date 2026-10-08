import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Icon, Btn, Money, Spinner } from '@/components/ui'
import {
  ApiError, createCotizacion, updateCotizacion, deleteCotizacion, previewCotizacion,
  getCotizacion, getClient, getBranding, getEmisor, mapClientRow,
} from '@/api'
import type { CotizacionRow, IndicadorFacturacion } from '@/api'
import { NewClientModal } from '@/features/clients/NewClientModal'
import { ProductoCombobox } from '@/features/products/ProductoCombobox'
import { UnidadMedidaSelect } from '@/components/UnidadMedidaSelect'
import {
  MSG_UNIDAD, admiteDecimales, problemaCantidad, unidadValida, useUnidadesMedida,
} from '@/components/unidadesMedida'
import { presentDocument } from '@/lib/file'
import { ahoraLocal, hoyLocal } from '@/lib/date'
import { aNumero } from '@/lib/format'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { useAvisoSalida } from '@/hooks/useAvisoSalida'
import type { Nav } from '@/config/navigation'
import type { Cliente, Producto } from '@/types/domain'
import { totalesFerreteria, type AjustesFerreteriaForm } from './totales'
import {
  MAX_DESCRIPCION, cuerpoFerreteria, ferreteriaFormSchema, lineaEnBlanco, mapearErrores, sinErrores,
  type ErroresFerreteria, type LineaFerreteriaForm,
} from './schema'
import { BloqueCliente } from './BloqueCliente'
import { DescripcionLinea } from './DescripcionLinea'
import { clienteDeFila, formatearRnc, lineaDesdeProducto, lineaLibre, lineasDeFila, siguienteId } from './lineas'
import '@/styles/factura-doc.css'

/* FISCALO — Cotización con el formato de Ferretería (spec 8.1).

   El mismo papel que la factura, con lo que pide la hoja de Excel de la
   tienda ("COTIZACION MERCANCIAS"): cantidad, descripción, valor unitario y
   valor total; Sub-total, ITBIS y TOTAL; y debajo los cargos y abonos que la
   hoja deja en blanco hasta que hacen falta.

   A diferencia de la de Gratex, cada línea es un artículo del catálogo (o una
   línea libre) con su unidad y su ITBIS, y el precio va SIN ITBIS: el impuesto
   se suma encima, como en la hoja. Así la cotización se convierte en factura
   con las líneas ligadas a sus productos y la venta descuenta inventario.

   Los totales de la pantalla salen de totalesFerreteria(), las mismas cuentas
   que hace el servidor al guardar (que ignora cualquier total que se le mande).
   No hay envío por correo: para este formato todavía no existe. */

/** Opciones del indicador de facturación DGII (tasa de ITBIS de la línea). */
const IND_FACT_OPCIONES: { value: IndicadorFacturacion; label: string }[] = [
  { value: 1, label: '18%' },
  { value: 2, label: '16%' },
  { value: 3, label: 'Tasa 0%' },
  { value: 4, label: 'Exento' },
]

const SIN_AJUSTES: AjustesFerreteriaForm = { cargosBancarios: 0, manejoBancario: 0, manoObra: 0, abono: 0, retencion: false }

/** Cargos y abonos guardados: montos DECIMAL como texto; una clave ausente es 0. */
function ajustesDeFila(row: CotizacionRow): AjustesFerreteriaForm {
  const a = row.ajustes ?? {}
  return {
    cargosBancarios: aNumero(a.cargos_bancarios),
    manejoBancario: aNumero(a.manejo_bancario),
    manoObra: aNumero(a.mano_obra),
    abono: aNumero(a.abono),
    // Se guarda el MONTO de la retención; la casilla solo dice si la hay. Al
    // guardar, el backend la vuelve a calcular sobre el Sub-total de ese momento.
    retencion: aNumero(a.retencion_isr) > 0,
  }
}

/**
 * Lo que cuenta como "cambio" al editar, en una sola cadena: se compara con la
 * foto que se toma al cargar. Si el usuario devuelve un campo a como estaba,
 * deja de contar.
 */
function huella(
  clienteId: string | null, libre: string, fecha: string, lineas: LineaFerreteriaForm[], ajustes: AjustesFerreteriaForm,
): string {
  return JSON.stringify([
    clienteId, libre.trim(), fecha, ajustes,
    lineas.map((l) => [l.prodId, l.descripcion, l.cantidad, l.precio, l.indFact, l.unidadMedida, l.tipoItem]),
  ])
}

/** 409: el formato del tenant ya no es este (pantalla vieja). Nada de lo que se haga aquí se puede guardar. */
const esDesactualizada = (e: unknown): e is ApiError => e instanceof ApiError && e.status === 409

/** Un monto del grupo "Cargos y abonos": etiqueta a la izquierda y el campo donde va la cifra. */
function CampoAjuste({
  id, label, value, error, onValue,
}: {
  id: string
  label: string
  value: number
  error?: string
  onValue: (v: number) => void
}) {
  return (
    <>
      <div className="fx-total-linea">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          className={'fx-field fx-num fx-ajuste-monto' + (error ? ' fx-field--err' : '')}
          type="number" min={0} step="0.01" inputMode="decimal"
          value={value}
          onChange={(e) => onValue(+e.target.value || 0)}
          aria-invalid={error ? true : undefined}
        />
      </div>
      {error && <span className="fx-err fx-ajuste-err"><Icon name="alert-circle" size={12} />{error}</span>}
    </>
  )
}

export function FerreteriaCotizacionForm({ nav, cotizacionId }: { nav: Nav; cotizacionId: number | null }) {
  const queryClient = useQueryClient()
  const editando = cotizacionId != null

  const [cliente, setCliente] = useState<Cliente | null>(null)
  /** false mientras el cliente es la ficha provisional de la fila (todavía sin su RNC). */
  const [clienteCompleto, setClienteCompleto] = useState(true)
  /** Nombre escrito a mano (NombreClienteLibre) que todavía no se guardó como cliente. */
  const [clienteLibre, setClienteLibre] = useState('')
  /** Lo escrito en el buscador de clientes sin elegir un resultado (ver ClientCombobox). */
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [nuevoCliente, setNuevoCliente] = useState(false)
  const [fecha, setFecha] = useState(hoyLocal)
  /** Día con que se cargó ('YYYY-MM-DD'). Si no se cambia, el PUT no manda fecha y se conserva la hora. */
  const [fechaGuardada, setFechaGuardada] = useState('')
  const [lineas, setLineas] = useState<LineaFerreteriaForm[]>([])
  const [ajustes, setAjustes] = useState<AjustesFerreteriaForm>(SIN_AJUSTES)
  const [ajustesAbiertos, setAjustesAbiertos] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [errores, setErrores] = useState<ErroresFerreteria>(sinErrores)
  const [guardando, setGuardando] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [borrando, setBorrando] = useState(false)
  /** Texto del 409. Con él la pantalla ya no guarda: solo ofrece recargar. */
  const [desactualizada, setDesactualizada] = useState<string | null>(null)
  /** Al editar: ya se volcó la fila en el formulario. */
  const [listo, setListo] = useState(!editando)
  /** Foto del documento tal como se cargó (ver huella); null = nueva o sin cargar. */
  const [original, setOriginal] = useState<string | null>(null)

  // --- Emisor: el membrete del papel, igual que en la factura ---
  const { data: emisor } = useApiQuery(['emisor'], getEmisor)
  const { data: branding } = useApiQuery(['branding'], getBranding)
  const emisorNombre = emisor?.nombre_comercial || emisor?.razon_social || ''
  const contactoEmisor = [emisor?.telefono, emisor?.correo].filter(Boolean).join(' · ')
  // Qué unidades admiten fracciones (metro, kilo) y cuáles se cuentan enteras.
  const unidades = useUnidadesMedida()

  // --- Carga al editar ---
  // Misma clave que CotizacionEditor: la fila ya está en la caché.
  const detalle = useApiQuery(
    ['cotizaciones', 'detail', cotizacionId],
    () => (cotizacionId != null ? getCotizacion(cotizacionId) : Promise.resolve(null)),
  )
  const cargada = useRef(false)
  useEffect(() => {
    const row = detalle.data
    if (cargada.current || !row) return
    cargada.current = true
    const ls = lineasDeFila(row)
    const aj = ajustesDeFila(row)
    const dia = String(row.date ?? '').slice(0, 10)
    const cli = clienteDeFila(row)
    setCodigo(row.code || `#${row.id}`)
    setLineas(ls)
    setAjustes(aj)
    setFecha(dia || hoyLocal())
    setFechaGuardada(dia)
    setCliente(cli)
    setClienteCompleto(cli == null)
    setOriginal(huella(cli?.id ?? null, '', dia || hoyLocal(), ls, aj))
    setListo(true)
  }, [detalle.data])

  // La fila solo trae id y nombre del cliente: se busca la ficha completa para
  // mostrar su RNC (va impreso en el PDF). Si el usuario ya eligió otro, se respeta.
  const clienteId = detalle.data?.client_id ?? null
  const clienteDetalle = useApiQuery(
    ['clients', 'detail', clienteId],
    () => (clienteId ? getClient(clienteId) : Promise.resolve(null)),
  )
  useEffect(() => {
    const row = clienteDetalle.data
    if (!row || clienteCompleto) return
    setCliente((c) => (c && c.id === String(row.id) ? mapClientRow(row) : c))
    setClienteCompleto(true)
  }, [clienteDetalle.data, clienteCompleto])

  // --- Totales: las mismas cuentas que el servidor (spec 6.2) ---
  const t = useMemo(
    () => totalesFerreteria(lineas.map((l) => ({ cantidad: l.cantidad, precio: l.precio, indFact: l.indFact })), ajustes),
    [lineas, ajustes],
  )
  /** Las líneas que se guardan: las filas vacías se descartan sin avisar (ver lineaEnBlanco). */
  const enUso = lineas.filter((l) => !lineaEnBlanco(l))
  // Un negativo también cuenta: el grupo no se puede cerrar con el error dentro.
  const hayAjustes = ajustes.cargosBancarios !== 0 || ajustes.manejoBancario !== 0 || ajustes.manoObra !== 0
    || ajustes.abono !== 0 || ajustes.retencion
  // Abierto si el usuario lo abrió o si ya tiene algo: con valores no se puede
  // esconder, porque cambian el TOTAL.
  const ajustesVisibles = ajustesAbiertos || hayAjustes

  // --- Salir sin guardar ---
  // Una nueva avisa en cuanto tiene algo escrito; una existente, cuando se tocó algo.
  const hayCambios = original != null && huella(cliente?.id ?? null, clienteLibre, fecha, lineas, ajustes) !== original
  const hayAlgoEscrito = cliente != null || clienteLibre.trim() !== '' || enUso.length > 0 || hayAjustes
  const salida = useAvisoSalida(
    editando ? hayCambios : hayAlgoEscrito,
    editando
      ? `Los cambios de la cotización ${codigo} no se han guardado. Si sales ahora, se pierden.`
      : 'Esta cotización no se ha guardado: no tiene número y no aparecerá en el listado. Si sales ahora, se pierde.',
    // Mientras se guarda o se borra no se pregunta: la navegación espera.
    guardando || borrando,
  )

  // --- Cliente ---
  const quitarErrCliente = () => setErrores((e) => (e.cliente ? { ...e, cliente: undefined } : e))
  const seleccionarCliente = (c: Cliente | null) => {
    setCliente(c)
    setClienteCompleto(true)
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
  const addLineaLibre = () => {
    setLineas((ls) => [...ls, lineaLibre(siguienteId(ls))])
    quitarErrForm()
  }
  /**
   * Artículo del catálogo (lineaDesdeProducto: su nombre, su precio SIN ITBIS,
   * su unidad, su tasa y si es bien o servicio). Si la última fila sigue vacía
   * se reemplaza, para no dejar huecos.
   */
  const addProducto = (p: Producto) => {
    setLineas((ls) => {
      const ultima = ls[ls.length - 1]
      return ultima && lineaEnBlanco(ultima)
        ? [...ls.slice(0, -1), lineaDesdeProducto(p, ultima.id)]
        : [...ls, lineaDesdeProducto(p, siguienteId(ls))]
    })
    quitarErrForm()
  }

  // --- Cargos y abonos ---
  const updAjuste = <K extends keyof AjustesFerreteriaForm>(k: K, v: AjustesFerreteriaForm[K]) => {
    setAjustes((a) => ({ ...a, [k]: v }))
    // El abono se juzga contra el TOTAL: cualquier ajuste puede resolverlo.
    setErrores((e) => (Object.keys(e.ajustes).length > 0 ? { ...e, ajustes: {} } : e))
  }

  /**
   * Valida con ferreteriaFormSchema y arma el cuerpo del API. Pinta los errores
   * junto a cada campo y resume cuántos hay. null = hay algo que corregir.
   */
  const validar = () => {
    const res = ferreteriaFormSchema({
      problemaCantidad: (c, u) => problemaCantidad(c, { unidadId: u, catalogo: unidades, maxDecimales: 2 }),
      problemaUnidad: (u) => (unidadValida(u, unidades) ? null : MSG_UNIDAD),
    }).safeParse({
      cliente,
      clienteEscrito: { buscador: cliente ? '' : busquedaCliente, libre: cliente ? '' : clienteLibre.trim() },
      fecha,
      lineas: enUso,
      ajustes,
    })
    if (!res.success) {
      setErrores(mapearErrores(res.error, enUso))
      const n = res.error.issues.length
      toast.error(n === 1 ? 'Revisa 1 campo de la cotización.' : `Revisa ${n} campos de la cotización.`)
      return null
    }
    if (!cliente) return null
    setErrores(sinErrores())
    // Nueva: el día elegido con la hora de ahora. Editando, la fecha solo
    // viaja si se cambió el día; si no, el backend conserva la fecha y la hora.
    const date = editando && fecha === fechaGuardada ? undefined : `${fecha} ${ahoraLocal().slice(11)}`
    return cuerpoFerreteria({ clienteId: Number(cliente.id), lineas: enUso, ajustes, date })
  }

  // Acción única: un doble clic crearía la misma cotización dos veces (y gastaría dos números).
  const guardar = useAccionUnica(async () => {
    if (desactualizada) return
    const cuerpo = validar()
    if (!cuerpo) return
    setGuardando(true)
    try {
      if (cotizacionId != null) {
        await updateCotizacion({ id: cotizacionId, ...cuerpo })
        toast.success(`Cotización ${codigo} actualizada.`)
      } else {
        const res = await createCotizacion(cuerpo)
        toast.success(`Cotización ${res.code} creada.`)
      }
      void queryClient.invalidateQueries({ queryKey: ['cotizaciones'] })
      salida.liberar()
      nav('cotizaciones', null, { replace: true })
    } catch (e) {
      // Los 422 del servidor dicen qué línea o qué monto falla: se muestran tal cual.
      if (esDesactualizada(e)) setDesactualizada(e.message)
      else toast.error(e instanceof ApiError ? e.message : 'No se pudo guardar la cotización.')
      setGuardando(false)
    }
  })

  const vistaPrevia = async () => {
    if (desactualizada) return
    const cuerpo = validar()
    if (!cuerpo) return
    setPreviewing(true)
    const tid = toast.loading('Generando vista previa…')
    try {
      // Editando viaja el id: el PDF sale con el formato y el número de esa cotización.
      presentDocument(await previewCotizacion(cotizacionId != null ? { ...cuerpo, id: cotizacionId } : cuerpo))
      toast.success('Vista previa generada.', { id: tid })
    } catch (e) {
      if (esDesactualizada(e)) {
        toast.dismiss(tid)
        setDesactualizada(e.message)
      } else {
        toast.error(e instanceof ApiError ? e.message : 'No se pudo generar la vista previa.', { id: tid })
      }
    } finally {
      setPreviewing(false)
    }
  }

  const borrar = useAccionUnica(async () => {
    if (cotizacionId == null) return
    setBorrando(true)
    try {
      await deleteCotizacion(cotizacionId)
      void queryClient.invalidateQueries({ queryKey: ['cotizaciones'] })
      toast.success(`Cotización ${codigo} eliminada.`)
      salida.liberar()
      nav('cotizaciones', null, { replace: true })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo eliminar la cotización.')
      setBorrando(false)
    }
  })

  // Lo escrito no se puede guardar en esta pantalla (el formato cambió): el
  // usuario ya decidió recargar, así que no se le vuelve a preguntar.
  const recargar = () => {
    salida.liberar()
    window.location.reload()
  }

  return (
    <div className="page fx-desk">
      <div className="row between" style={{ marginBottom: 14 }}>
        <Btn variant="secondary" size="sm" icon="arrow-left" onClick={() => nav('cotizaciones')}>Cotizaciones</Btn>
        {editando && confirmDel ? (
          <span className="row gap-sm" style={{ alignItems: 'center' }}>
            <span className="text-sm muted">¿Eliminar esta cotización?</span>
            <Btn variant="ghost" size="sm" onClick={() => setConfirmDel(false)}>No</Btn>
            <Btn variant="danger" size="sm" onClick={() => void borrar()} disabled={borrando}>
              {borrando ? 'Eliminando…' : 'Sí, eliminar'}
            </Btn>
          </span>
        ) : editando ? (
          <Btn variant="ghost" size="sm" icon="trash-2" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDel(true)}>
            Eliminar
          </Btn>
        ) : null}
      </div>

      <article className="fx-sheet fx-sheet--ancha">
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
            <span className="fx-eyebrow">Propuesta comercial</span>
            <div className="fx-tipo-fijo">Cotización mercancías</div>
            <span className={'fx-numero' + (codigo ? '' : ' fx-numero-pend')}>
              {codigo || 'Se asigna al guardar'}
            </span>
            <label className="fx-eyebrow" htmlFor="fx-cot-fecha">Fecha</label>
            <input
              id="fx-cot-fecha"
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

        {/* --- Cliente: el mismo rótulo que la hoja impresa --- */}
        {/* El modal de cliente nuevo va al final, fuera de la hoja (ver BloqueCliente). */}
        <BloqueCliente
          cliente={cliente}
          clienteCompleto={clienteCompleto}
          clienteLibre={clienteLibre}
          error={errores.cliente}
          avisoSinDoc="Este cliente no tiene RNC ni cédula: la cotización sale sin ese dato."
          onSeleccionar={seleccionarCliente}
          onBusquedaChange={(texto) => { setBusquedaCliente(texto); quitarErrCliente() }}
          onLibreChange={(v) => { setClienteLibre(v); quitarErrCliente() }}
          onNuevoCliente={() => setNuevoCliente(true)}
        />

        {/* --- Líneas: las columnas de la hoja, más unidad e ITBIS --- */}
        <section className="fx-items" style={{ marginTop: 24 }}>
          <div className="fx-grid-ecf fx-grid-cot-fer fx-items-head">
            <span />
            <span style={{ textAlign: 'right' }}>Cant.</span>
            <span>Unidad</span>
            <span>Descripción</span>
            <span style={{ textAlign: 'right' }}>Precio</span>
            <span>ITBIS</span>
            <span style={{ textAlign: 'right' }}>Valor total</span>
          </div>

          {!listo ? (
            <div className="state" style={{ padding: 26 }}><Spinner /></div>
          ) : (
            lineas.map((l, i) => {
              const le = errores.lineas[l.id]
              const m = t.lineas[i]
              // Paso y teclado según la unidad: metros o kilos admiten
              // fracciones; unidades o cajas se cuentan enteras.
              const enteras = !admiteDecimales(l.unidadMedida, unidades)
              return (
                <div className={'fx-grid-ecf fx-grid-cot-fer fx-row' + (le ? ' fx-row-incompleta' : '')} key={l.id}>
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
                      placeholder="Artículo o trabajo (ej. Fundas de cemento gris)"
                      aria-label={`Descripción de la línea ${i + 1}`}
                      aria-invalid={le?.descripcion ? true : undefined}
                    />
                    {le?.descripcion && <span className="fx-err"><Icon name="alert-circle" size={12} />{le.descripcion}</span>}
                    <div className="fx-linea-pie">
                      {/* Ligada al catálogo = al facturarla descuenta inventario. */}
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

                  <div className="fx-cell" data-label="Precio">
                    <input
                      className={'fx-field fx-num' + (le?.precio ? ' fx-field--err' : '')}
                      type="number" min={0} step="any" inputMode="decimal"
                      value={l.precio}
                      onChange={(e) => updLinea(l.id, { precio: +e.target.value || 0 })}
                      aria-label={`Precio sin ITBIS de la línea ${i + 1}`}
                      aria-invalid={le?.precio ? true : undefined}
                    />
                    {le?.precio && <span className="fx-err">{le.precio}</span>}
                  </div>

                  <select
                    className="fx-tasa fx-cell" data-label="ITBIS"
                    value={l.indFact}
                    onChange={(e) => updLinea(l.id, { indFact: Number(e.target.value) as IndicadorFacturacion })}
                    aria-label={`ITBIS de la línea ${i + 1}`}
                  >
                    {IND_FACT_OPCIONES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>

                  {/* Valor total = cantidad × precio, sin ITBIS (la columna D de la hoja). */}
                  <span className="fx-importe fx-cell" data-label="Valor total">
                    <Money value={m?.base ?? 0} cur={false} />
                    <span className="fx-contador" style={{ display: 'block' }}>ITBIS <Money value={m?.itbis ?? 0} cur={false} /></span>
                  </span>
                </div>
              )
            })
          )}

          {listo && lineas.length === 0 && (
            <div className="state" style={{ padding: 26 }}>
              <span className="text-sm" style={{ color: errores.form ? 'var(--danger)' : 'var(--text-2)' }}>
                {errores.form ?? 'Sin líneas. Busca un artículo del catálogo o agrega una línea libre.'}
              </span>
            </div>
          )}

          <div className="fx-add-row">
            <div className="fx-buscar-prod">
              <ProductoCombobox
                onSelect={addProducto}
                mostrarPrecio
                placeholder="Agregar del catálogo: nombre, SKU o categoría…"
              />
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

        {/* --- Totales, en el orden de la hoja --- */}
        <section className="fx-cierre">
          <div />
          <div className="fx-totales-box fx-totales-box--fer">
            <div className="fx-total-linea">
              <span>Sub-total</span><span><Money value={t.subtotal} cur={false} /></span>
            </div>
            <div className="fx-total-linea">
              <span>{t.etiquetaItbis}</span><span><Money value={t.itbis} cur={false} /></span>
            </div>

            {/* Cargos y abonos: la hoja los deja en blanco y el PDF solo imprime
                los que tienen valor. Cargos y mano de obra se suman al TOTAL sin
                ITBIS; retención y abono solo bajan lo que queda por pagar. */}
            <div className="fx-ajustes">
              {ajustesVisibles ? (
                <>
                  <div className="fx-ajustes-head">
                    <span className="fx-eyebrow">Cargos y abonos</span>
                    {!hayAjustes && (
                      <button type="button" className="fx-detalle-toggle" onClick={() => setAjustesAbiertos(false)} aria-expanded>
                        − Ocultar
                      </button>
                    )}
                  </div>
                  <CampoAjuste
                    id="fx-aj-cargos" label="Cargos bancarios" value={ajustes.cargosBancarios}
                    error={errores.ajustes.cargosBancarios} onValue={(v) => updAjuste('cargosBancarios', v)}
                  />
                  <CampoAjuste
                    id="fx-aj-manejo" label="Manejos de operaciones bancarias" value={ajustes.manejoBancario}
                    error={errores.ajustes.manejoBancario} onValue={(v) => updAjuste('manejoBancario', v)}
                  />
                  <CampoAjuste
                    id="fx-aj-mano" label="Costo mano de obra" value={ajustes.manoObra}
                    error={errores.ajustes.manoObra} onValue={(v) => updAjuste('manoObra', v)}
                  />
                  <label className="fx-ajuste-check">
                    <input
                      type="checkbox"
                      checked={ajustes.retencion}
                      onChange={(e) => updAjuste('retencion', e.target.checked)}
                    />
                    Retención Renta 5%
                  </label>
                  <CampoAjuste
                    id="fx-aj-abono" label="Abono realizado" value={ajustes.abono}
                    error={errores.ajustes.abono} onValue={(v) => updAjuste('abono', v)}
                  />
                </>
              ) : (
                <button
                  type="button"
                  className="fx-detalle-toggle fx-ajustes-abrir"
                  onClick={() => setAjustesAbiertos(true)}
                  aria-expanded={false}
                >
                  + Cargos y abonos
                </button>
              )}
            </div>

            <div className="fx-total-final">
              <span>Total RD$</span><span><Money value={t.total} cur={false} /></span>
            </div>
            {t.retencion > 0 && (
              <div className="fx-total-linea">
                <span>Retención Renta por Tercero 5%</span><span>−<Money value={t.retencion} cur={false} /></span>
              </div>
            )}
            {t.abono > 0 && (
              <div className="fx-total-linea">
                <span>Abono realizado</span><span>−<Money value={t.abono} cur={false} /></span>
              </div>
            )}
            {/* Solo con retención o abono, igual que en el PDF: sin ellos sería el TOTAL repetido. */}
            {t.mostrarRestante && (
              <div className="fx-total-linea fx-total-linea--restante">
                <span>Restante (Adeudado)</span><span><Money value={t.restante} cur={false} /></span>
              </div>
            )}
          </div>
        </section>

        <footer className="fx-nota">
          Los precios no incluyen ITBIS: se suma encima · el número lo asigna el sistema al guardar ·
          convertir la cotización en factura no la modifica
        </footer>
      </article>

      {/* --- Acciones (fuera del papel) --- */}
      <div className="fx-bar fx-bar--ancha">
        <div className="fx-bar-total">
          {editando && hayCambios ? (
            <span className="fx-cambios">Cambios sin guardar</span>
          ) : (
            <span className="text-sm muted">
              {enUso.length === 0 ? 'Sin líneas todavía' : `${enUso.length} ${enUso.length === 1 ? 'línea' : 'líneas'}`}
            </span>
          )}
          <b><Money value={t.total} cur={false} /></b>
        </div>
        <div className="row gap-sm fx-acciones">
          {desactualizada ? (
            // 409: el formato de la empresa cambió y esta pantalla ya no sirve
            // para guardar. Se dice en la barra, que siempre está a la vista.
            <>
              <span className="fx-motivo fx-motivo--alerta" role="alert">{desactualizada}</span>
              <Btn variant="primary" icon="refresh-cw" onClick={recargar}>Recargar</Btn>
            </>
          ) : (
            <>
              <Btn variant="ghost" onClick={() => nav('cotizaciones')}>Cancelar</Btn>
              <Btn variant="secondary" icon="eye" onClick={() => void vistaPrevia()} disabled={previewing || !listo}>
                {previewing ? 'Generando…' : 'Vista previa'}
              </Btn>
              <Btn variant="primary" icon="save" onClick={() => void guardar()} disabled={guardando || borrando || !listo}>
                {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear cotización'}
              </Btn>
            </>
          )}
        </div>
      </div>

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
