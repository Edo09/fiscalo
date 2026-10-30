// El menú Más (anexo 5.2): una hoja inferior con la cuenta (empresa, RNC, ambiente, usuario y rol) y lo secundario: la versión nueva, las pantallas de configuración,
// la ayuda, el tema y cerrar sesión. Que una fila no salga no es un control de seguridad: lo es la guardia de rutas, y detrás de ella el API.
//
// Es una hoja de RUTA: `#/mas` es la dueña de su entrada del historial (`historialDeRuta`: la hoja no empuja ninguna ni escucha `popstate`). Abrirla es `navegar`
// (la barra empuja, `accionHoja('abrir')`); cerrarla (Esc, el asa, el fondo) es `atras({ id: 'facturas' })`: retrocede, o si se abrió con un enlace directo reemplaza por
// Facturas. Tocar una fila es `navegar(hash, { reemplazar: true })` (`accionHoja('fila')`): cambia la entrada de Más por la pantalla de la fila, así un solo atrás
// de Android cae en la pestaña de donde se vino (lo fija router.test.ts). App dibuja detrás la última pantalla que no es Más.
//
// Cerrar sesión pregunta siempre («¿Cerrar sesión?», con el foco en Cancelar). Si hay una factura sin confirmar, después sale una segunda hoja: «Ver factura» o «Salir
// igual». Salir NO borra ese registro (`cerrarSesionExpress` solo quita el borrador y lo reciente): el mismo usuario en la misma empresa lo retoma al volver a entrar.
// Esa segunda hoja es una hoja corriente (empuja su entrada) cuya acción navega, así que «Ver factura» la cierra primero y navega cuando el atrás aterrizó
// (`cuandoAterriceElAtras`, ui/capas.ts); navegar con su entrada puesta la dejaría enterrada bajo la factura.
//
// Todo lo de este archivo es del arranque (no importa nada de las pantallas perezosas, que se bajan con `precargarRuta`).
import { useId, useState } from 'react'
import { formatoRnc } from '@/pos/montos'
import { BUILD_ID, SOPORTE_WHATSAPP } from '~/config'
import { esAdmin } from '~/entitlements'
import type { Entitlements, UsuarioExpress } from '~/entitlements'
import { borrar, escribirTexto, leerTexto } from '~/lib/almacen'
import { etiquetaAmbiente } from '~/lib/etiquetas'
import { useIndicadoresFacturar } from '~/lib/indicadores'
import type { IndicadoresFacturar } from '~/lib/indicadores'
import { cerrarSesionExpress } from '~/lib/sesion'
import { useVersionNueva } from '~/lib/version'
import { etiquetaRol, filasMas } from '~/nav'
import { atras, navegar, parseHash } from '~/router'
import type { Ruta } from '~/router'
import { BottomSheet } from '~/ui/BottomSheet'
import { cuandoAterriceElAtras } from '~/ui/capas'
import { Button } from '~/ui/Button'
import { ConfirmSheet } from '~/ui/ConfirmSheet'
import { Icon } from '~/ui/Icon'
import type { IconName } from '~/ui/Icon'
import { SegmentedControl } from '~/ui/SegmentedControl'
import { precargarRuta } from './registro'
import './Mas.css'

/** La clave de localStorage del tema: la que lee `public/theme-init.js` antes del primer pintado (`light`, `dark`, o ninguna para el automático). */
const CLAVE_TEMA = 'express.theme'

type Tema = 'auto' | 'claro' | 'oscuro'
type SinConfirmar = NonNullable<IndicadoresFacturar['sinConfirmar']>

/** El tema guardado: `light` y `dark` son Claro y Oscuro, y cualquier otra cosa (o nada) es Automático, que sigue al sistema. */
function leerTema(): Tema {
  const guardado = leerTexto(CLAVE_TEMA)
  if (guardado === 'light') return 'claro'
  return guardado === 'dark' ? 'oscuro' : 'auto'
}

/** Aplica el tema en el acto y lo guarda: el atributo `data-theme` de la raíz (el que lee tokens.css) y `express.theme`. Automático quita las dos cosas. */
function aplicarTema(tema: Tema): void {
  if (tema === 'auto') {
    borrar(CLAVE_TEMA)
    document.documentElement.removeAttribute('data-theme')
    return
  }
  const valor = tema === 'claro' ? 'light' : 'dark'
  escribirTexto(CLAVE_TEMA, valor)
  document.documentElement.setAttribute('data-theme', valor)
}

/** Adónde lleva «Ver factura»: el mismo destino que el «Ver» de la franja (shell/Franjas.tsx): si cambia uno, cambia el otro. */
const destinoDe = (s: SinConfirmar): Ruta => (s.facturaId !== null ? { id: 'factura', facturaId: s.facturaId } : { id: 'facturar-resultado', clave: s.clave })

/** El enlace de «Ayuda y soporte»: un chat de WhatsApp con el nombre de la empresa y la versión, y nada más (nunca un token ni una contraseña). */
function enlaceDeSoporte(empresa: string): string {
  const numero = SOPORTE_WHATSAPP.replace(/\D/g, '') // wa.me pide solo dígitos, sin el + ni espacios
  const texto = `Hola, necesito ayuda con Fiscalpoint Express. Empresa: ${empresa}. Versión: ${BUILD_ID}.`
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
}

export function Mas(p: { usuario: UsuarioExpress; entitlements: Entitlements }): JSX.Element {
  const { usuario, entitlements } = p
  const hayVersionNueva = useVersionNueva()
  const { enviando, sinConfirmar } = useIndicadoresFacturar()
  const idSinConfirmar = useId()
  const [tema, setTema] = useState<Tema>(leerTema)
  const [paso, setPaso] = useState<'confirmar' | 'sinConfirmar' | null>(null)
  const [saliendo, setSaliendo] = useState(false)

  const filas = filasMas(entitlements, { admin: esAdmin(usuario), soporte: SOPORTE_WHATSAPP !== '' })
  const ambiente = etiquetaAmbiente(entitlements.tenant.ambiente)
  const rnc = entitlements.tenant.rnc
  const empresa = entitlements.tenant.nombre

  const salir = async (): Promise<void> => {
    setSaliendo(true)
    try {
      await cerrarSesionExpress() // al terminar App ve que no hay sesión y dibuja el Login; esta hoja se desmonta
    } catch (e) {
      // `cerrarSesionExpress` cierra la sesión pase lo que pase y solo después deja pasar un fallo (sesion.test.ts, 10f): App ya dibuja el Login y no queda nada que decirle al
      // usuario. Se anota aquí y no se deja como rechazo sin atender: quien la llama (`alConfirmar`, `salirIgual`) la lanza con `void`.
      console.error('[Mas] cerrar la sesión falló', e)
    } finally {
      setSaliendo(false)
    }
  }

  const alConfirmar = (): void => {
    if (sinConfirmar !== null) {
      setPaso('sinConfirmar')
      return
    }
    setPaso(null)
    void salir()
  }

  const verFactura = (): void => {
    if (sinConfirmar === null) return
    const destino = destinoDe(sinConfirmar)
    // Antes de cerrar la hoja: el atrás que pide su cierre aterriza después, y es lo que hay que esperar para reemplazar la entrada de Más (ui/capas.ts).
    cuandoAterriceElAtras(() => navegar(destino, { reemplazar: true }))
    setPaso(null)
  }

  const salirIgual = (): void => {
    setPaso(null)
    void salir()
  }

  const cambiarTema = (nuevo: Tema): void => {
    setTema(nuevo)
    aplicarTema(nuevo)
  }

  // Sin e-NCF todavía (la respuesta no lo trajo) se dice «Tu factura»: el texto no lo inventa.
  const nombreDeLaFactura = sinConfirmar === null || sinConfirmar.eNcf === '' ? 'Tu factura' : sinConfirmar.eNcf

  return (
    <>
      <BottomSheet
        abierto
        historialDeRuta
        onCerrar={() => atras({ id: 'facturas' })}
        titulo={empresa === '' ? 'Más' : empresa}
        cerrarConFondo={!saliendo}
      >
        <div className="mas__cuenta">
          <p className="mas__rnc">
            {rnc !== '' && <span>RNC {formatoRnc(rnc)}</span>}
            <span className={`mas__ambiente mas__ambiente--${ambiente.tono}`}>{ambiente.texto}</span>
          </p>
          <p className="mas__usuario">
            {usuario.name} · {etiquetaRol(usuario.role)}
          </p>
        </div>

        <ul className="mas__lista">
          {hayVersionNueva && (
            <li className="mas__version">
              <p className="mas__version-texto">
                <Icon name="refresh-cw" size={20} />
                Hay una versión nueva
              </p>
              {/* En un bloque, no en una fila flex: el motivo del botón deshabilitado sale debajo de él (Button.tsx). */}
              <div>
                <Button
                  variante="secundario"
                  bloque
                  disabled={enviando}
                  razon="Hay una factura enviándose: espera a que termine."
                  onClick={() => window.location.reload()}
                >
                  Actualizar
                </Button>
              </div>
            </li>
          )}

          {filas.map((fila) => {
            if (fila.id === 'tema') {
              return (
                <li key={fila.id} className="mas__tema">
                  <p className="mas__tema-etiqueta" aria-hidden="true">
                    {fila.etiqueta}
                  </p>
                  <SegmentedControl<Tema>
                    etiquetaGrupo="Tema"
                    opciones={[
                      { valor: 'auto', etiqueta: 'Auto' },
                      { valor: 'claro', etiqueta: 'Claro' },
                      { valor: 'oscuro', etiqueta: 'Oscuro' },
                    ]}
                    valor={tema}
                    onCambio={cambiarTema}
                  />
                </li>
              )
            }
            if (fila.id === 'salir') {
              return (
                <li key={fila.id}>
                  {/* Mientras sale, la fila lo dice en vez de quedarse deshabilitada sin motivo. */}
                  <button type="button" className="mas__fila mas__fila--peligro" disabled={saliendo} aria-busy={saliendo || undefined} onClick={() => setPaso('confirmar')}>
                    <Icon name={fila.icono as IconName} />
                    <span className="mas__etiqueta">{saliendo ? 'Cerrando sesión...' : fila.etiqueta}</span>
                  </button>
                </li>
              )
            }
            if (fila.id === 'ayuda') {
              return (
                <li key={fila.id}>
                  <a className="mas__fila" href={enlaceDeSoporte(empresa)} target="_blank" rel="noopener noreferrer">
                    <Icon name={fila.icono as IconName} />
                    <span className="mas__etiqueta">{fila.etiqueta}</span>
                    <span className="mas__nota">WhatsApp</span>
                  </a>
                </li>
              )
            }
            if (fila.hash === undefined) return null
            const destino = parseHash(fila.hash)
            return (
              <li key={fila.id}>
                <button type="button" className="mas__fila" onPointerDown={() => precargarRuta(destino.id)} onClick={() => navegar(destino, { reemplazar: true })}>
                  <Icon name={fila.icono as IconName} />
                  <span className="mas__etiqueta">{fila.etiqueta}</span>
                  <Icon name="chevron-right" />
                </button>
              </li>
            )
          })}
        </ul>

        {/* La versión de esta compilación: texto que se selecciona entero de un toque, para dárselo a soporte. */}
        <p className="mas__build">
          v <span className="mas__build-id">{BUILD_ID}</span> · {usuario.name}
        </p>
      </BottomSheet>

      <ConfirmSheet
        abierto={paso === 'confirmar'}
        pregunta="¿Cerrar sesión?"
        consecuencia="Tendrás que volver a entrar con tu correo y contraseña."
        etiquetaAccion="Cerrar sesión"
        peligro
        onConfirmar={alConfirmar}
        onCancelar={() => setPaso(null)}
      />

      {/* La segunda confirmación no es un ConfirmSheet: su botón de la izquierda no es «Cancelar» sino «Ver factura» (cancelar es Esc, el atrás, el asa o el fondo). */}
      <BottomSheet
        abierto={paso === 'sinConfirmar' && sinConfirmar !== null}
        onCerrar={() => setPaso(null)}
        titulo="Hay una factura sin confirmar"
        cerrarConFondo
        rol="alertdialog"
        idDescripcion={idSinConfirmar}
        pie={
          <div className="mas__botones">
            {/* El foco entra a «Ver factura», lo que no destruye nada: Intro sobre la hoja recién abierta no puede cerrar la sesión. */}
            <Button variante="secundario" data-foco-inicial="" onClick={verFactura}>
              Ver factura
            </Button>
            <Button variante="peligro" onClick={salirIgual}>
              Salir igual
            </Button>
          </div>
        }
      >
        <p id={idSinConfirmar} className="mas__consecuencia">
          {nombreDeLaFactura} sigue en proceso. Espera la confirmación antes de salir.
        </p>
      </BottomSheet>
    </>
  )
}
