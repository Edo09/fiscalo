// El aviso emergente de Express (anexo 8): propio, uno a la vez, sobre la barra inferior y sobre el teclado, 4 segundos (6 si ofrece «Deshacer»), sin sonner.
// Lo que decide qué se ve y cuánto dura está en ui/colaToast.ts; aquí están el almacén de la app, `mostrarToast` (se llama desde cualquier sitio, no solo
// desde un componente) y `ToastHost`, que lo dibuja.
//
// `ToastHost` se monta UNA vez, fuera del contenido de las rutas (el shell, tarea 17): con dos, el mismo aviso saldría dos veces. Se dibuja en el `body` (un
// portal) y se marca con `data-capa-exenta`: con una hoja abierta, lo demás del documento queda oculto a los lectores de pantalla, y un aviso («Copiado»,
// «Línea quitada») tiene que anunciarse igual. Las dos regiones (`status` para info y ok, `alert` para un error) existen siempre, vacías, porque un lector de
// pantalla solo anuncia lo que cambia dentro de una región que ya estaba.
import { useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { crearColaToast, duracionMs } from './colaToast'
import type { ToastItem, TipoToast } from './colaToast'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { useTecladoAbierto } from './viewport'
import './Toast.css'

const cola = crearColaToast()

// El plan pide que `mostrarToast` salga de este mismo archivo (las pantallas la importan de `ui/Toast`), y la regla de react-refresh quiere un archivo de
// componentes sin funciones sueltas: aquí manda el plan.
/** Pone un aviso a la vista (reemplaza al que hubiera). Con `deshacer` lleva el botón «Deshacer» y dura 6 segundos. */
// eslint-disable-next-line react-refresh/only-export-components
export function mostrarToast(texto: string, opts?: { deshacer?: () => void; tipo?: TipoToast }): void {
  cola.mostrar(texto, opts)
}

/** El icono de cada tipo: la forma además del color (el color nunca va solo). */
const ICONO: Record<TipoToast, IconName> = { info: 'circle-alert', ok: 'circle-check', error: 'circle-x' }

function Aviso(p: { item: ToastItem }): JSX.Element {
  const { item } = p
  return (
    <div className={`toast toast--${item.tipo}`}>
      <Icon name={ICONO[item.tipo]} />
      <p className="toast__texto">{item.texto}</p>
      {item.deshacer !== undefined && (
        <Button
          variante="texto"
          onClick={() => {
            item.deshacer?.()
            cola.descartar(item.id)
          }}
        >
          Deshacer
        </Button>
      )}
    </div>
  )
}

export function ToastHost(): JSX.Element {
  const aviso = useSyncExternalStore(cola.suscribir, cola.leer)
  const teclado = useTecladoAbierto() // mantiene `--kb-inset` al día: el CSS sube el aviso con él
  useEffect(() => {
    if (aviso === null) return
    const espera = window.setTimeout(() => cola.descartar(aviso.id), duracionMs(aviso))
    return () => window.clearTimeout(espera)
  }, [aviso])

  return createPortal(
    <div className={teclado ? 'avisos avisos--teclado' : 'avisos'} data-avisos="" data-capa-exenta="">
      <div role="status">{aviso !== null && aviso.tipo !== 'error' && <Aviso item={aviso} />}</div>
      <div role="alert">{aviso !== null && aviso.tipo === 'error' && <Aviso item={aviso} />}</div>
    </div>,
    document.body,
  )
}
