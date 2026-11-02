// Paso 1 del asistente de venta, «Cliente» (anexo 6.4): el tipo de comprobante (con un selector solo si la cuenta vende dos o más), el cliente y «Continuar».
//  - El cliente se busca con un solo campo (300 ms de espera, 20 por página, «Cargar más»); sin texto salen los más recientes. Un RNC pegado con guiones se busca solo por sus dígitos.
//  - Una fila no se puede elegir si el comprobante pide RNC y el cliente no lo tiene («Sin RNC»), o si su RNC es el de la empresa (no se factura a uno mismo): lo dice la fila.
//  - El consumo (E32) puede ir sin cliente: «Consumidor final». Desde RD$250,000 Revisar pedirá un comprador con RNC.
//  - «Nuevo cliente» abre el formulario del cliente (ui/ClienteForm) en una hoja, con la consulta a la DGII; el cliente que se guarda queda elegido.
//  - Al montarse lee y borra `facturarA` (el cliente que «Facturar a este cliente», en Clientes, dejó escrito) y lo deja elegido.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { ClientRow } from '@/api/types'
import { FRESCURA } from '@/config/cache'
import { PAGINA_LISTAS } from '~/config'
import { tieneModulo, tiposVenta } from '~/entitlements'
import { borrar, claveUsuario, leerJson } from '~/lib/almacen'
import { clienteSel, tieneContenido } from '~/lib/carrito'
import type { ClienteSel } from '~/lib/carrito'
import { normalizarCliente } from '~/lib/filas'
import { estadoFilaCliente } from '~/lib/reglas'
import { nombreTipo } from '~/lib/tiposEcf'
import { useEnLinea } from '~/net/enLinea'
import { buscarClientes } from '~/net/catalogo'
import { navegar } from '~/router'
import { Banner } from '~/ui/Banner'
import { BottomSheet } from '~/ui/BottomSheet'
import { Button } from '~/ui/Button'
import { Cabecera } from '~/ui/Cabecera'
import { ClienteForm } from '~/ui/ClienteForm'
import { ConfirmSheet } from '~/ui/ConfirmSheet'
import { EmptyState } from '~/ui/EmptyState'
import { Icon } from '~/ui/Icon'
import { SegmentedControl } from '~/ui/SegmentedControl'
import { Skeleton } from '~/ui/Skeleton'
import { StickyActionBar } from '~/ui/StickyActionBar'
import { TextField } from '~/ui/TextField'
import { consultaDeBusqueda, DEBOUNCE_MS, formatearRnc, sinRepetir, useDebounced, useLenta } from './ayudas'
import { PasoCargando, PasoDerecha } from './Paso'
import { descartarBorrador, iniciarWizard, useCuenta, useWizardStore, wizard } from './useWizard'
import './PasoCliente.css'

/** El cliente que dejó escrito «Facturar a este cliente» (`facturarA`, contrato con Clientes), o null si lo que hay no tiene esa forma. */
function clienteDeFacturarA(v: unknown): ClienteSel | null {
  if (typeof v !== 'object' || v === null) return null
  const f = v as Record<string, unknown>
  if (typeof f.id !== 'number' || !Number.isSafeInteger(f.id) || f.id < 1 || typeof f.nombre !== 'string' || f.nombre.trim() === '') return null
  return {
    id: f.id,
    nombre: f.nombre,
    rnc: typeof f.rnc === 'string' && f.rnc !== '' ? f.rnc : null,
    permiteCredito: f.permiteCredito === true,
    descuento: typeof f.descuento === 'number' && Number.isFinite(f.descuento) ? f.descuento : 0,
  }
}

const ALTO_FILA = 64

export default function PasoCliente(): JSX.Element {
  const { entitlements, u } = useCuenta()
  const carrito = useWizardStore((s) => s.carrito)
  const recuperado = useWizardStore((s) => s.recuperado)
  const enLinea = useEnLinea()
  const cliente = useQueryClient()

  const tiposClave = tiposVenta(entitlements).join(',')
  const tipos = useMemo(() => (tiposClave === '' ? [] : tiposClave.split(',')), [tiposClave])
  useEffect(() => {
    if (u !== null) iniciarWizard(u, tipos)
  }, [u, tipos])

  // «Facturar a este cliente»: se lee y se borra una sola vez, cuando el carrito ya está cargado.
  const leyoFacturarA = useRef(false)
  const hayCarrito = carrito !== null
  useEffect(() => {
    if (u === null || !hayCarrito || leyoFacturarA.current) return
    leyoFacturarA.current = true
    const clave = claveUsuario(u.tenantId, u.userId, 'facturarA')
    const dato = leerJson<unknown>(clave)
    if (dato === null) return
    borrar(clave)
    const elegido = clienteDeFacturarA(dato)
    if (elegido !== null) wizard.elegirCliente(elegido)
  }, [u, hayCarrito])

  const [texto, setTexto] = useState('')
  const consulta = consultaDeBusqueda(useDebounced(texto, DEBOUNCE_MS))
  const hayClientes = tieneModulo(entitlements, 'clientes')
  const lista = useInfiniteQuery({
    queryKey: ['facturar', 'clientes', consulta],
    queryFn: ({ pageParam }) => buscarClientes({ query: consulta, page: pageParam, pageSize: PAGINA_LISTAS }),
    initialPageParam: 1,
    getNextPageParam: (ultima) => (ultima.totalPages !== null && ultima.page < ultima.totalPages ? ultima.page + 1 : undefined),
    staleTime: FRESCURA.NORMAL,
    enabled: hayClientes,
  })
  const items = useMemo(() => sinRepetir(lista.data?.pages.flatMap((p) => p.items) ?? []), [lista.data])
  const lenta = useLenta(lista.isFetching)

  const [hojaNueva, setHojaNueva] = useState(false)
  const [sucio, setSucio] = useState(false)
  const [descartando, setDescartando] = useState(false)

  if (carrito === null || entitlements === null) return <PasoCargando titulo="Nueva factura" />

  const tipo = carrito.tipo
  const rncEmisor = entitlements.tenant.rnc
  const elegido = carrito.cliente
  const estadoElegido = elegido === null ? null : estadoFilaCliente(elegido, tipo, rncEmisor)
  const exigeCliente = tipo !== '32'

  let razon: string | undefined
  if (elegido === null && exigeCliente) razon = 'Elige un cliente para continuar.'
  else if (estadoElegido?.motivo === 'sinRnc') razon = 'Este cliente no tiene RNC: elige otro o agrégale el RNC en Clientes.'
  else if (estadoElegido?.motivo === 'rncPropio') razon = 'Es el RNC de tu empresa: elige otro cliente.'

  /** El formulario de un cliente nuevo termina con uno (guardado o ya existente): queda elegido, y las listas se piden de nuevo para que aparezca. */
  const usar = (fila: ClientRow): void => {
    wizard.elegirCliente(clienteSel(normalizarCliente(fila)))
    void cliente.invalidateQueries({ queryKey: ['facturar', 'clientes'] })
    setHojaNueva(false)
    setSucio(false)
  }
  const cerrarHoja = (): void => {
    setHojaNueva(false)
    setSucio(false)
  }
  /** Cerrar la hoja por el atrás, Esc o arrastrándola: con algo escrito pregunta antes de perderlo. */
  const pedirCerrar = (): void => {
    if (sucio) setDescartando(true)
    else cerrarHoja()
  }
  const soloDigitos = /^\d+$/.test(consulta)
  const inicialDelForm = soloDigitos ? { rnc: consulta } : consulta !== '' ? consulta : undefined

  const reintentar = (): void => void (lista.isFetchNextPageError ? lista.fetchNextPage() : lista.refetch())
  const esqueleto = (
    <div aria-busy="true">
      <Skeleton filas={4} alto={ALTO_FILA} />
    </div>
  )

  let resultados: JSX.Element
  if (!hayClientes) {
    resultados = <Banner tono="info">Tu plan no incluye Clientes.{!exigeCliente && ' Puedes facturar a consumidor final.'}</Banner>
  } else if (lista.data === undefined) {
    resultados =
      lista.isError || !enLinea ? (
        <Banner tono="danger" accion={{ etiqueta: 'Reintentar', onClick: reintentar }}>
          {enLinea ? 'No se pudo cargar la lista.' : 'Sin conexión: no se puede cargar la lista.'}
        </Banner>
      ) : (
        esqueleto
      )
  } else if (items.length === 0) {
    resultados =
      consulta === '' ? (
        <EmptyState icono="users" titulo="Aún no tienes clientes" texto="Crea el primero con «Nuevo cliente»." accion={enLinea ? { etiqueta: 'Nuevo cliente', onClick: () => setHojaNueva(true) } : undefined} />
      ) : (
        <EmptyState
          icono="search"
          titulo={`Sin resultados para «${consulta}»`}
          texto={soloDigitos ? 'Ese RNC no está en tus clientes. Crea el cliente y lo buscamos en la DGII.' : undefined}
          accion={enLinea ? { etiqueta: 'Nuevo cliente', onClick: () => setHojaNueva(true) } : undefined}
        />
      )
  } else {
    resultados = (
      <>
        {lista.isError && (
          <Banner tono="danger" accion={{ etiqueta: 'Reintentar', onClick: reintentar }}>
            No se pudo cargar la lista.
          </Banner>
        )}
        <ul className="pc-lista">
          {items.map((c) => {
            const e = estadoFilaCliente(c, tipo, rncEmisor)
            const esElegido = elegido?.id === c.id
            return (
              <li key={c.id}>
                <button type="button" className="pc-fila" disabled={!e.seleccionable} aria-pressed={esElegido} onClick={() => wizard.elegirCliente(clienteSel(c))}>
                  <span className="pc-fila__texto">
                    <span className="pc-fila__nombre">{c.nombre}</span>
                    {c.rnc !== null && <span className="pc-fila__detalle">RNC {formatearRnc(c.rnc)}</span>}
                    {e.motivo === 'sinRnc' && <span className="pc-fila__aviso">Sin RNC</span>}
                    {e.motivo === 'rncPropio' && <span className="pc-fila__aviso">Es el RNC de tu empresa</span>}
                  </span>
                  {esElegido ? <Icon name="circle-check" label="Elegido" /> : e.seleccionable ? <Icon name="chevron-right" /> : null}
                </button>
              </li>
            )
          })}
        </ul>
        {lista.hasNextPage && (
          <Button variante="secundario" bloque cargando={lista.isFetchingNextPage} onClick={() => void lista.fetchNextPage()}>
            Cargar más
          </Button>
        )}
      </>
    )
  }

  return (
    <div className="pantalla paso">
      <Cabecera titulo="Nueva factura" derecha={<PasoDerecha paso={1} salir />} />
      <div className="paso__cuerpo">
        {recuperado && tieneContenido(carrito) && (
          <Banner tono="info" accion={{ etiqueta: 'Empezar de nuevo', onClick: descartarBorrador }}>
            Retomamos la factura que tenías sin emitir.
          </Banner>
        )}
        {tipos.length >= 2 && <SegmentedControl etiquetaGrupo="Tipo de comprobante" opciones={tipos.map((t) => ({ valor: t, etiqueta: `E${t}` }))} valor={tipo} onCambio={wizard.elegirTipo} />}
        <p className="paso__tipo">
          Factura {nombreTipo(tipo)} (E{tipo})
        </p>

        <div className="paso__tarjeta pc-elegido">
          <div className="pc-elegido__texto">
            <p className="pc-elegido__etiqueta">Cliente de la factura</p>
            {elegido !== null ? (
              <>
                <p className="pc-elegido__nombre">{elegido.nombre}</p>
                {elegido.rnc !== null && <p className="pc-elegido__detalle">RNC {formatearRnc(elegido.rnc)}</p>}
              </>
            ) : exigeCliente ? (
              <p className="pc-elegido__detalle">Sin cliente. Elige uno de la lista.</p>
            ) : (
              <>
                <p className="pc-elegido__nombre">Consumidor final</p>
                <p className="pc-elegido__detalle">Sin identificar al comprador. Para identificarlo, elige un cliente.</p>
              </>
            )}
          </div>
          {elegido !== null && (
            <Button variante="texto" onClick={() => wizard.elegirCliente(null)}>
              Quitar
            </Button>
          )}
        </div>

        {hayClientes && (
          <>
            <TextField tipo="search" etiqueta="Buscar cliente por nombre o RNC" valor={texto} onCambio={setTexto} limpiable enterkeyhint="search" autoComplete="off" />
            <Button variante="secundario" bloque icono="plus" disabled={!enLinea} razon="Sin conexión: no se puede crear un cliente." onClick={() => setHojaNueva(true)}>
              Nuevo cliente
            </Button>
          </>
        )}
        {!enLinea && lista.data !== undefined && <Banner tono="warning">Sin conexión: solo se ven los clientes que ya cargaron.</Banner>}
        {lenta && <Banner tono="info">Tarda más de lo normal</Banner>}
        {resultados}
      </div>

      <StickyActionBar>
        <Button bloque disabled={razon !== undefined} razon={razon} onClick={() => navegar({ id: 'facturar-productos' })}>
          Continuar
        </Button>
      </StickyActionBar>

      <BottomSheet abierto={hojaNueva} titulo="Cliente nuevo" onCerrar={pedirCerrar} cerrarConFondo={!sucio}>
        <ClienteForm modo="rapido" inicial={inicialDelForm} etiquetaGuardar="Guardar y usar" tipoEcf={tipo} onGuardado={usar} onUsarExistente={usar} onCancelar={cerrarHoja} onSucio={setSucio} />
      </BottomSheet>
      <ConfirmSheet
        abierto={descartando}
        pregunta="¿Descartar?"
        consecuencia="Lo que escribiste del cliente se pierde."
        etiquetaAccion="Descartar"
        peligro
        onConfirmar={() => {
          setDescartando(false)
          cerrarHoja()
        }}
        onCancelar={() => setDescartando(false)}
      />
    </div>
  )
}
