// La galería de las primitivas de UI de Express: cada una en cada estado, para revisarlas a la vista, con el tema claro y el oscuro (anexo 8). SOLO DEV: `App` la
// monta con `import.meta.env.DEV` en `#/dev/ui` (tarea 17) y el build de producción no la trae. `NumericField`, `DateField` y `FullScreenPicker` no tienen
// pantalla que los use en el plan 06 (los usan los planes 07 y 09): esta galería es lo único que los ejercita.
//
// No monta `ToastHost`: lo monta `App`, una sola vez (con dos saldría cada aviso dos veces); si falta, la sección de avisos lo dice. El historial de arriba muestra
// `history.state` (la marca `{ fx, bajo }` del router y la de las hojas, `hoja`) y `--kb-inset`: abrir y cerrar una hoja sobre esta pantalla no debe cambiar `fx`.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { PORCLAVE } from '~/lib/etiquetas'
import { hoy } from '~/lib/reloj'
import { Banner } from '~/ui/Banner'
import { BottomSheet } from '~/ui/BottomSheet'
import { Button } from '~/ui/Button'
import { Cabecera } from '~/ui/Cabecera'
import { ConfirmSheet } from '~/ui/ConfirmSheet'
import { EmptyState } from '~/ui/EmptyState'
import { ErrorBoundary } from '~/ui/ErrorBoundary'
import { FullScreenPicker } from '~/ui/FullScreenPicker'
import { Icon } from '~/ui/Icon'
import type { IconName } from '~/ui/Icon'
import { ICONOS } from '~/ui/iconos'
import { OfflineBanner } from '~/ui/OfflineBanner'
import { SegmentedControl } from '~/ui/SegmentedControl'
import { Skeleton } from '~/ui/Skeleton'
import { StatusChip } from '~/ui/StatusChip'
import { StickyActionBar } from '~/ui/StickyActionBar'
import { DateField, NumericField, TextField } from '~/ui/TextField'
import { mostrarToast } from '~/ui/Toast'
import { bloquearScroll, useKbInset } from '~/ui/viewport'
import './Galeria.css'

function Seccion(p: { titulo: string; nota?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="galeria__seccion">
      <h2 className="galeria__titulo">{p.titulo}</h2>
      {p.nota !== undefined && <p className="galeria__nota">{p.nota}</p>}
      {p.children}
    </section>
  )
}

/** Lo que dice el historial ahora, en una línea: `history.state` de la entrada actual, cuántas entradas hay y el hash. */
const leerHistorial = (): string => `state ${JSON.stringify(history.state)} · entradas ${history.length} · ${location.hash || '(sin hash)'}`

/** El estado del historial y del teclado, siempre a la vista arriba: se relee cada 250 ms y en cada `popstate`. */
function Estado(): JSX.Element {
  const kb = useKbInset() // también mantiene `--kb-inset` al día en toda la galería
  const [historial, setHistorial] = useState(leerHistorial)
  useEffect(() => {
    const releer = (): void => setHistorial(leerHistorial())
    const reloj = window.setInterval(releer, 250)
    window.addEventListener('popstate', releer)
    return () => {
      window.clearInterval(reloj)
      window.removeEventListener('popstate', releer)
    }
  }, [])
  return (
    <p className="galeria__estado">
      {historial}
      <br />
      --kb-inset {kb}px · {kb > 150 ? 'teclado abierto' : 'sin teclado'} · scrollY {Math.round(window.scrollY)}
    </p>
  )
}

/** Hace creer a la app que no hay red (`navigator.onLine` en false y el evento `offline`) mientras `activo`: así se ve el `OfflineBanner` de verdad. */
function useSinConexionSimulada(activo: boolean): void {
  useEffect(() => {
    if (!activo) return
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
    return () => {
      Reflect.deleteProperty(navigator, 'onLine') // vuelve al `onLine` del navegador
      window.dispatchEvent(new Event('online'))
    }
  }, [activo])
}

/** Lanza un error al dibujarse cuando `armada`: lo que atrapa el `ErrorBoundary`. */
function Bomba(p: { armada: boolean }): JSX.Element {
  if (p.armada) throw new Error('Error de prueba provocado desde la galería')
  return <p className="galeria__nota">Todo bien dentro del límite de error.</p>
}

const ICONOS_TODOS = Object.keys(ICONOS) as IconName[]
const ESTADOS_DE_CHIP: Array<string | null> = [...Object.keys(PORCLAVE), null, '', 'ESTADO_NUEVO']
const NOMBRES = ['Constructora Cibao', 'Min. de Obras Públicas', 'Ferretería Don Pepe', 'Farmacia Central', 'Colmado La Esquina', 'Distribuidora del Este']
/** 60 clientes de mentira, siempre los mismos: el selector filtra por nombre y pagina de 20 en 20. */
const CLIENTES = Array.from({ length: 60 }, (_, i) => ({
  id: i + 1,
  nombre: `${NOMBRES[i % NOMBRES.length]} ${String(i + 1).padStart(2, '0')}`,
  rnc: `1-31-${String(10000 + i * 37).padStart(5, '0')}-${i % 10}`,
}))

type TemaDemo = 'auto' | 'claro' | 'oscuro'
type HojaDemo = 'simple' | 'pie' | 'larga' | 'formulario' | 'sesion' | 'padre' | null

export default function Galeria(): JSX.Element {
  const [campos, setCampos] = useState<Record<string, string>>({
    limpiable: 'Texto que se puede borrar',
    rnc: '',
    decimal: '',
    fecha: '',
    fechaError: '',
    password: 'secreto',
    hoja: '',
  })
  const fijar = (clave: string) => (valor: string) => setCampos((previos) => ({ ...previos, [clave]: valor }))
  const [cargando, setCargando] = useState(false)
  const [tema, setTema] = useState<TemaDemo>('auto')
  const [opcionesDos, setOpcionesDos] = useState<'si' | 'no'>('si')
  const [opcionesCuatro, setOpcionesCuatro] = useState('uno')
  const [semilla, setSemilla] = useState(0)
  const [armada, setArmada] = useState(false)
  const [reinicio, setReinicio] = useState(0)

  const [hoja, setHoja] = useState<HojaDemo>(null)
  const [encima, setEncima] = useState(false)
  const [intentosDeCerrar, setIntentosDeCerrar] = useState(0)
  const [confirmar, setConfirmar] = useState<'normal' | 'peligro' | null>(null)
  const [resultadoConfirmar, setResultadoConfirmar] = useState('ninguno')
  const [selector, setSelector] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [visibles, setVisibles] = useState(20)
  const [elegido, setElegido] = useState('nadie')
  const [barra, setBarra] = useState(false)
  const [sinConexion, setSinConexion] = useState(false)
  const [sinAnfitrion, setSinAnfitrion] = useState(false)
  const [bloqueo, setBloqueo] = useState('sin probar')
  useSinConexionSimulada(sinConexion)

  const coincidencias = CLIENTES.filter((c) => c.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()))
  const probarAviso = (texto: string, opts?: Parameters<typeof mostrarToast>[1]): void => {
    mostrarToast(texto, opts)
    window.setTimeout(() => setSinAnfitrion(document.querySelector('[data-avisos]') === null), 0)
  }
  const probarBloqueo = (): void => {
    const liberar = bloquearScroll()
    setBloqueo('bloqueada 3 s: intenta desplazar la página')
    window.setTimeout(() => {
      liberar()
      setBloqueo(`liberada: la página volvió a scrollY ${Math.round(window.scrollY)}`)
    }, 3000)
  }
  const cargar = (): void => {
    setCargando(true)
    window.setTimeout(() => setCargando(false), 2000)
  }

  return (
    <div className="galeria">
      <h1 className="galeria__titulo-pagina">Galería de primitivas</h1>
      <Estado />

      <Seccion titulo="Iconos" nota="Los 26 de la lista cerrada (iconos.ts), a 24 px.">
        <div className="galeria__iconos">
          {ICONOS_TODOS.map((nombre) => (
            <div key={nombre} className="galeria__icono">
              <Icon name={nombre} />
              {nombre}
            </div>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Botones">
        <div className="galeria__fila">
          <Button>Primario 52</Button>
          <Button variante="secundario">Secundario</Button>
          <Button variante="peligro">Peligro</Button>
          <Button variante="texto">Texto</Button>
          <Button icono="plus">Con icono</Button>
          <Button variante="texto">
            <Icon name="x" label="Cerrar" />
          </Button>
        </div>
        <div className="galeria__fila">
          <Button cargando={cargando} onClick={cargar}>
            {cargando ? 'Enviando' : 'Tocar para cargar'}
          </Button>
          <Button variante="secundario" cargando>
            Cargando
          </Button>
        </div>
        <p className="galeria__nota">Deshabilitado con su razón, en una columna (un botón así nunca va directo en una fila):</p>
        <div className="galeria__columna">
          <Button disabled razon="Sin conexión: conéctate para entrar">
            Entrar
          </Button>
          <Button variante="secundario" bloque disabled razon="Falta elegir un cliente">
            Continuar
          </Button>
        </div>
      </Seccion>

      <Seccion titulo="Campos" nota="Todos a 52 px y 16 px de letra; un error reemplaza a la ayuda.">
        <div className="galeria__pila">
          <TextField etiqueta="Nombre" valor={campos.nombre ?? ''} onCambio={fijar('nombre')} ayuda="Como sale en la factura" />
          <TextField etiqueta="Correo" valor={campos.correo ?? ''} onCambio={fijar('correo')} tipo="email" modoInput="email" error="Escribe un correo válido" />
          <TextField etiqueta="Con borrar" valor={campos.limpiable} onCambio={fijar('limpiable')} limpiable />
          <TextField etiqueta="Buscar e-NCF o cliente" valor={campos.busca ?? ''} onCambio={fijar('busca')} tipo="search" limpiable enterkeyhint="search" />
          <TextField etiqueta="Contraseña" valor={campos.password} onCambio={fijar('password')} tipo="password" />
          <TextField etiqueta="Deshabilitado" valor="No se puede cambiar" onCambio={() => {}} disabled />
          <NumericField
            etiqueta="RNC (solo enteros, 11 dígitos)"
            valor={campos.rnc}
            onCambio={fijar('rnc')}
            maxLength={11}
            ayuda="Pega «RNC: 1-31-00000-1»: quedan solo los dígitos"
          />
          <NumericField etiqueta="Precio (2 decimales)" valor={campos.decimal} onCambio={fijar('decimal')} decimales={2} enterkeyhint="done" />
          <DateField etiqueta="Fecha límite de pago" valor={campos.fecha} onCambio={fijar('fecha')} min={hoy()} />
          <DateField etiqueta="Fecha con error" valor={campos.fechaError} onCambio={fijar('fechaError')} error="La fecha no puede ser anterior a hoy" />
        </div>
      </Seccion>

      <Seccion titulo="Avisos en línea">
        <div className="galeria__pila">
          <Banner tono="info">Algo que conviene saber.</Banner>
          <Banner tono="warning" titulo="Con título">
            Revisa esto antes de seguir.
          </Banner>
          <Banner tono="danger" accion={{ etiqueta: 'Reintentar', onClick: () => probarAviso('Reintentando', { tipo: 'info' }) }}>
            No se pudo cargar la lista.
          </Banner>
          <Banner tono="ok">Se guardó.</Banner>
        </div>
      </Seccion>

      <Seccion titulo="Chip de estado" nota="Los 25 estados DGII que conoce la app, y tres que no (nulo, vacío, nuevo): esos caen en «Sin confirmar».">
        <div className="galeria__chips">
          {ESTADOS_DE_CHIP.map((estado) => (
            <div key={String(estado)} className="galeria__chip">
              <StatusChip estado={estado} />
              {estado === null ? 'null' : estado === '' ? "''" : estado}
            </div>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Control segmentado">
        <div className="galeria__pila">
          <SegmentedControl<TemaDemo>
            etiquetaGrupo="Tema"
            opciones={[
              { valor: 'auto', etiqueta: 'Automático' },
              { valor: 'claro', etiqueta: 'Claro' },
              { valor: 'oscuro', etiqueta: 'Oscuro' },
            ]}
            valor={tema}
            onCambio={setTema}
          />
          <SegmentedControl<'si' | 'no'>
            etiquetaGrupo="Dos opciones"
            opciones={[
              { valor: 'si', etiqueta: 'Sí' },
              { valor: 'no', etiqueta: 'No' },
            ]}
            valor={opcionesDos}
            onCambio={setOpcionesDos}
          />
          <SegmentedControl
            etiquetaGrupo="Cuatro opciones, una con un rótulo largo que se parte"
            opciones={[
              { valor: 'uno', etiqueta: 'Uno' },
              { valor: 'dos', etiqueta: 'Crédito fiscal' },
              { valor: 'tres', etiqueta: 'Consumo' },
              { valor: 'cuatro', etiqueta: 'Régimen especial' },
            ]}
            valor={opcionesCuatro}
            onCambio={setOpcionesCuatro}
          />
        </div>
      </Seccion>

      <Seccion titulo="Esqueleto" nota="No se dibuja en los primeros 150 ms.">
        <Button variante="secundario" onClick={() => setSemilla((n) => n + 1)}>
          Volver a cargar
        </Button>
        <Skeleton key={semilla} filas={3} />
      </Seccion>

      <Seccion titulo="Estado vacío">
        <div className="galeria__pila">
          <EmptyState
            icono="file-text"
            titulo="Aún no has emitido nada"
            texto="Cuando emitas una factura, aparece aquí."
            accion={{ etiqueta: 'Crear primera factura', onClick: () => probarAviso('Crear primera factura') }}
          />
          <EmptyState icono="search" titulo="Sin resultados" />
        </div>
      </Seccion>

      <Seccion titulo="Cabecera" nota="«Volver» sale de la galería (retrocede o va a Facturas).">
        <div className="galeria__pila">
          <div className="galeria__caja">
            <Cabecera
              titulo="Facturas"
              derecha={
                <button type="button" className="galeria__icono-boton" aria-label="Actualizar" onClick={() => probarAviso('Actualizando')}>
                  <Icon name="refresh-cw" />
                </button>
              }
            />
          </div>
          <div className="galeria__caja">
            <Cabecera titulo="Un título muy largo que no cabe en una sola línea de la cabecera" atras="historial" />
          </div>
        </div>
      </Seccion>

      <Seccion titulo="Límite de error" nota="El error se muestra en la consola a propósito.">
        <div className="galeria__fila">
          <Button variante="secundario" onClick={() => setArmada(true)}>
            Provocar un error
          </Button>
          <Button variante="secundario" onClick={() => (setArmada(false), setReinicio((n) => n + 1))}>
            Restablecer
          </Button>
        </div>
        <ErrorBoundary key={reinicio}>
          <Bomba armada={armada} />
        </ErrorBoundary>
      </Seccion>

      <Seccion titulo="Hojas" nota="Abre y cierra con el atrás, Esc, el asa (80 px) y el fondo (solo donde se puede): el historial de arriba no pierde su fx.">
        <div className="galeria__fila">
          <Button variante="secundario" onClick={() => setHoja('simple')}>
            Simple
          </Button>
          <Button variante="secundario" onClick={() => setHoja('pie')}>
            Con pie
          </Button>
          <Button variante="secundario" onClick={() => setHoja('larga')}>
            Contenido largo
          </Button>
          <Button variante="secundario" onClick={() => setHoja('formulario')}>
            Con campos
          </Button>
          <Button variante="secundario" onClick={() => setHoja('sesion')}>
            Sin cierre
          </Button>
          <Button variante="secundario" onClick={() => setHoja('padre')}>
            Hoja sobre hoja
          </Button>
          <HojaDeRutaSimulada />
        </div>
        <BottomSheet abierto={hoja === 'simple'} onCerrar={() => setHoja(null)} titulo="Hoja simple" cerrarConFondo>
          <p className="galeria__nota">Se cierra con el atrás, Esc, el asa o tocando el fondo.</p>
        </BottomSheet>
        <BottomSheet
          abierto={hoja === 'pie'}
          onCerrar={() => setHoja(null)}
          titulo="Hoja con pie"
          pie={
            <>
              <Button bloque onClick={() => setHoja(null)}>
                Guardar
              </Button>
              <Button variante="secundario" bloque disabled razon="Sin conexión: no puedes guardar ahora.">
                Guardar y emitir
              </Button>
            </>
          }
        >
          <p className="galeria__nota">El pie queda fijo abajo; el botón deshabilitado dice su razón debajo. Tocar el fondo no cierra esta hoja.</p>
        </BottomSheet>
        <BottomSheet abierto={hoja === 'larga'} onCerrar={() => setHoja(null)} titulo="Contenido largo" pie={<Button bloque onClick={() => setHoja(null)}>Listo</Button>}>
          {Array.from({ length: 40 }, (_, i) => (
            <p key={i} className="galeria__nota">
              Línea {i + 1}: el cuerpo se desplaza solo y no arrastra la página.
            </p>
          ))}
        </BottomSheet>
        <BottomSheet
          abierto={hoja === 'formulario'}
          onCerrar={() => setHoja(null)}
          titulo="Hoja con campos"
          pie={<Button bloque onClick={() => setHoja(null)}>Guardar</Button>}
        >
          <div className="galeria__pila">
            <TextField etiqueta="Nombre" valor={campos.hoja} onCambio={fijar('hoja')} enterkeyhint="next" />
            <NumericField etiqueta="Teléfono" valor={campos.telefono ?? ''} onCambio={fijar('telefono')} enterkeyhint="done" />
          </div>
        </BottomSheet>
        <BottomSheet
          abierto={hoja === 'sesion'}
          onCerrar={() => setIntentosDeCerrar((n) => n + 1)}
          titulo="Tu sesión venció"
          pie={<Button bloque onClick={() => setHoja(null)}>Entrar y continuar</Button>}
        >
          <p className="galeria__nota">
            Esta hoja no se puede cerrar (su `onCerrar` no hace nada): el atrás, Esc y el asa no la cierran y el historial no pierde la entrada. Intentos de cerrar:{' '}
            {intentosDeCerrar}.
          </p>
        </BottomSheet>
        <BottomSheet
          abierto={hoja === 'padre'}
          onCerrar={() => setHoja(null)}
          titulo="Hoja de abajo"
          cerrarConFondo
          pie={<Button bloque onClick={() => setEncima(true)}>Abrir otra encima</Button>}
        >
          <p className="galeria__nota">La de encima lleva «Cerrar las dos», que las cierra en el mismo turno.</p>
        </BottomSheet>
        <BottomSheet
          abierto={hoja === 'padre' && encima}
          onCerrar={() => setEncima(false)}
          titulo="Hoja de encima"
          cerrarConFondo
          pie={
            <>
              <Button bloque onClick={() => setEncima(false)}>Cerrar esta</Button>
              <Button variante="secundario" bloque onClick={() => (setEncima(false), setHoja(null))}>Cerrar las dos</Button>
            </>
          }
        >
          <p className="galeria__nota">Un atrás cierra solo esta; al cerrarla, el foco vuelve al botón de la hoja de abajo.</p>
        </BottomSheet>
      </Seccion>

      <Seccion titulo="Confirmaciones" nota={`Última respuesta: ${resultadoConfirmar}. El foco entra a «Cancelar».`}>
        <div className="galeria__fila">
          <Button variante="secundario" onClick={() => setConfirmar('normal')}>
            Reemplazar borrador
          </Button>
          <Button variante="secundario" onClick={() => setConfirmar('peligro')}>
            Cerrar sesión
          </Button>
        </div>
        <ConfirmSheet
          abierto={confirmar === 'normal'}
          pregunta="Ya tienes una factura sin emitir"
          consecuencia="Si sigues, ese borrador se reemplaza con este cliente."
          etiquetaAccion="Reemplazar"
          onConfirmar={() => (setResultadoConfirmar('Reemplazar'), setConfirmar(null))}
          onCancelar={() => (setResultadoConfirmar('Cancelar'), setConfirmar(null))}
        />
        <ConfirmSheet
          abierto={confirmar === 'peligro'}
          pregunta="¿Cerrar sesión?"
          consecuencia="Tendrás que volver a entrar con tu correo y contraseña."
          etiquetaAccion="Cerrar sesión"
          peligro
          onConfirmar={() => (setResultadoConfirmar('Cerrar sesión'), setConfirmar(null))}
          onCancelar={() => (setResultadoConfirmar('Cancelar'), setConfirmar(null))}
        />
      </Seccion>

      <Seccion titulo="Selector a pantalla completa" nota={`Elegido: ${elegido}. Busca por nombre; «Cargar más» suma 20.`}>
        <Button variante="secundario" onClick={() => setSelector(true)}>
          Elegir cliente
        </Button>
        <FullScreenPicker
          abierto={selector}
          titulo="Elegir cliente"
          placeholderBusqueda="Buscar cliente"
          busqueda={busqueda}
          onBusqueda={(v) => (setBusqueda(v), setVisibles(20))}
          onCerrar={() => setSelector(false)}
          pie={
            <Button variante="secundario" bloque onClick={() => (setElegido('un cliente nuevo'), setSelector(false))}>
              + Nuevo cliente
            </Button>
          }
        >
          <ul className="galeria__lista">
            {coincidencias.slice(0, visibles).map((c) => (
              <li key={c.id}>
                <button type="button" className="galeria__elemento" onClick={() => (setElegido(c.nombre), setSelector(false))}>
                  {c.nombre}
                  <small>{c.rnc}</small>
                </button>
              </li>
            ))}
          </ul>
          {coincidencias.length === 0 && <p className="galeria__nota galeria__relleno">Sin resultados para «{busqueda}»</p>}
          {coincidencias.length > visibles && (
            <div className="galeria__mas">
              <Button bloque onClick={() => setVisibles((n) => n + 20)}>
                Cargar más
              </Button>
            </div>
          )}
        </FullScreenPicker>
      </Seccion>

      <Seccion titulo="Aviso emergente" nota="Uno a la vez, sobre la barra y el teclado: 4 s, y 6 s con «Deshacer».">
        <div className="galeria__fila">
          <Button variante="secundario" onClick={() => probarAviso('Copiado')}>
            Info
          </Button>
          <Button variante="secundario" onClick={() => probarAviso('Factura guardada', { tipo: 'ok' })}>
            Ok
          </Button>
          <Button variante="secundario" onClick={() => probarAviso('No se pudo guardar. Inténtalo de nuevo.', { tipo: 'error' })}>
            Error
          </Button>
          <Button variante="secundario" onClick={() => probarAviso('Línea quitada', { deshacer: () => probarAviso('Línea restaurada', { tipo: 'ok' }) })}>
            Con deshacer
          </Button>
        </div>
        {sinAnfitrion && (
          <Banner tono="warning" titulo="No hay ToastHost montado">
            App debe montar &lt;ToastHost /&gt; una vez, fuera del contenido de las rutas.
          </Banner>
        )}
      </Seccion>

      <Seccion titulo="Barra de acción anclada" nota="Fija abajo, sobre el teclado (enfoca un campo de arriba), con su hueco en el flujo para no tapar lo último.">
        <Button variante="secundario" onClick={() => setBarra((v) => !v)}>
          {barra ? 'Quitar la barra' : 'Mostrar la barra'}
        </Button>
        {barra && (
          <StickyActionBar>
            <Button bloque onClick={() => probarAviso('Continuar')}>
              Continuar
            </Button>
            <Button variante="secundario" bloque disabled razon="Falta elegir un cliente">
              Emitir
            </Button>
          </StickyActionBar>
        )}
      </Seccion>

      <Seccion titulo="Sin conexión" nota="Simula `navigator.onLine` en false: la franja sale arriba del contenido.">
        <Button variante="secundario" onClick={() => setSinConexion((v) => !v)}>
          {sinConexion ? 'Volver a la red' : 'Simular sin conexión'}
        </Button>
        <OfflineBanner />
      </Seccion>

      <Seccion titulo="Bloqueo del scroll" nota={`bloquearScroll(): ${bloqueo}. Las hojas lo usan solo donde el navegador no contiene el scroll (iOS 15).`}>
        <Button variante="secundario" onClick={probarBloqueo}>
          Bloquear 3 segundos
        </Button>
      </Seccion>
    </div>
  )
}

/**
 * Una hoja cuya entrada del historial es de «la ruta» (como `#/mas`): la galería, no la hoja, empuja la entrada y escucha `popstate`, y `onCerrar` es un
 * `history.back()`, que es lo que hace el `atras` del router. La hoja (`historialDeRuta`) no empuja nada: abrirla suma UNA entrada al historial de arriba, no dos.
 */
function HojaDeRutaSimulada(): JSX.Element {
  const [abierta, setAbierta] = useState(false)
  useEffect(() => {
    if (!abierta) return
    const alIr = (): void => {
      if ((history.state as { rutaDemo?: boolean } | null)?.rutaDemo !== true) setAbierta(false)
    }
    window.addEventListener('popstate', alIr)
    return () => window.removeEventListener('popstate', alIr)
  }, [abierta])
  const abrir = (): void => {
    history.pushState({ ...(history.state ?? {}), rutaDemo: true }, '')
    setAbierta(true)
  }
  return (
    <>
      <Button variante="secundario" onClick={abrir}>
        De ruta (simulada)
      </Button>
      <BottomSheet abierto={abierta} historialDeRuta onCerrar={() => history.back()} titulo="Hoja de ruta" cerrarConFondo>
        <p className="galeria__nota">La entrada del historial es de la ruta: la hoja no empuja otra ni escucha el atrás. Esc, el asa y el fondo llaman a `history.back()`.</p>
      </BottomSheet>
    </>
  )
}
