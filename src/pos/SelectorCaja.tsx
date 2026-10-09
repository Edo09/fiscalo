// Selector de la caja (orden y cantidad del catálogo): en lugar del <select>
// nativo, que en Windows se ve como un formulario de escritorio, un botón con su
// rótulo y valor, y un menú de filas grandes para el dedo, con lo que hace cada
// opción.
//
// - El menú va en un portal con posición fija (no lo recorta ningún contenedor) y
//   se abre hacia arriba si abajo no cabe.
// - Teclado: Enter, espacio o ↓ lo abren; ↑ ↓ Inicio Fin recorren; Enter o
//   espacio eligen (en el keydown, no por el click que genera el navegador); Escape o Tab cierran y el foco vuelve al botón. Escape no
//   sigue hasta la pantalla de venta (allí Escape ofrece cancelar la venta).
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from '@/components/ui/Icon'
import type { OpcionSelector } from './catalogoVista'

interface Props<T extends string | number> {
  /** Rótulo corto sobre el valor ("Ordenar"). */
  rotulo: string
  /** Encabezado del menú ("Ordenar productos por"). */
  titulo: string
  icono: IconName
  valor: T
  opciones: OpcionSelector<T>[]
  onCambio: (valor: T) => void
}

const SEPARACION = 8
const MARGEN = 8

export function SelectorCaja<T extends string | number>({ rotulo, titulo, icono, valor, opciones, onCambio }: Props<T>) {
  const id = useId()
  const [abierto, setAbierto] = useState(false)
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const botonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const actual = opciones.find((o) => o.valor === valor) ?? opciones[0]

  const cerrar = useCallback((devolverFoco: boolean) => {
    setAbierto(false)
    setPos(null)
    if (devolverFoco) botonRef.current?.focus()
  }, [])

  const ubicar = useCallback(() => {
    const boton = botonRef.current?.getBoundingClientRect()
    const menu = menuRef.current
    if (!boton || !menu) return
    const ancho = Math.max(boton.width, menu.offsetWidth)
    const alto = menu.offsetHeight
    const izquierda = Math.max(MARGEN, Math.min(boton.left, window.innerWidth - MARGEN - ancho))
    const abajo = window.innerHeight - boton.bottom - SEPARACION - MARGEN
    const arriba = boton.top - SEPARACION - MARGEN
    const haciaArriba = abajo < alto && arriba > abajo
    setPos({
      left: izquierda,
      minWidth: boton.width,
      ...(haciaArriba ? { bottom: window.innerHeight - boton.top + SEPARACION } : { top: boton.bottom + SEPARACION }),
      transformOrigin: haciaArriba ? 'bottom left' : 'top left',
    })
  }, [])

  // Antes de pintar: mide el menú (oculto) y lo ubica. Cuando ya se ve, la opción
  // elegida toma el foco, una vez por apertura: reubicarlo al desplazar no debe
  // quitárselo a la opción a la que se llegó con las flechas.
  const enfocar = useRef(false)
  useLayoutEffect(() => {
    if (!abierto) return
    enfocar.current = true
    ubicar()
  }, [abierto, ubicar])
  useEffect(() => {
    if (!pos || !enfocar.current) return
    enfocar.current = false
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
  }, [pos])

  // Fuera del menú (o al cambiar el tamaño de la ventana) se cierra; al desplazar, se reubica.
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: PointerEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !botonRef.current?.contains(t)) cerrar(false)
    }
    const redimensionar = () => cerrar(false)
    window.addEventListener('pointerdown', fuera, true)
    window.addEventListener('resize', redimensionar)
    window.addEventListener('scroll', ubicar, true)
    return () => {
      window.removeEventListener('pointerdown', fuera, true)
      window.removeEventListener('resize', redimensionar)
      window.removeEventListener('scroll', ubicar, true)
    }
  }, [abierto, cerrar, ubicar])

  const elegir = (o: OpcionSelector<T>) => {
    onCambio(o.valor)
    cerrar(true)
  }

  const teclaBoton = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setAbierto(true)
    }
  }

  const teclaMenu = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const ir = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus() }
    if (e.key === 'ArrowDown') ir(i + 1)
    else if (e.key === 'ArrowUp') ir(i - 1)
    else if (e.key === 'Home') ir(0)
    else if (e.key === 'End') ir(items.length - 1)
    else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) {
      // Se elige aquí y no con el click que el navegador genera del Enter: así
      // vale igual para cualquier teclado (también uno en pantalla).
      e.preventDefault()
      elegir(opciones[i])
    } else if (e.key === 'Escape') {
      // Que no llegue a la pantalla de venta: allí Escape ofrece cancelar la venta.
      e.preventDefault()
      e.stopPropagation()
      cerrar(true)
    } else if (e.key === 'Tab') cerrar(true)
  }

  return (
    <>
      <button
        ref={botonRef} type="button" className={'pos-sel' + (abierto ? ' abierto' : '')}
        aria-haspopup="listbox" aria-expanded={abierto} aria-controls={abierto ? id : undefined}
        aria-label={`${rotulo}: ${actual.nombre}`}
        onClick={() => (abierto ? cerrar(false) : setAbierto(true))} onKeyDown={teclaBoton}
      >
        <span className="pos-sel-ic"><Icon name={icono} size={17} /></span>
        <span className="pos-sel-txt">
          <small>{rotulo}</small>
          <b>{actual.corto}</b>
        </span>
        <Icon name="chevron-down" size={18} className="pos-sel-flecha" />
      </button>
      {abierto && createPortal(
        <div
          ref={menuRef} id={id} role="listbox" aria-label={titulo} className="pos-sel-menu"
          style={pos ?? { visibility: 'hidden', top: 0, left: 0 }} onKeyDown={teclaMenu}
        >
          <div className="pos-sel-titulo">{titulo}</div>
          {opciones.map((o) => {
            const elegida = o.valor === valor
            return (
              <button key={String(o.valor)} type="button" role="option" aria-selected={elegida}
                className={'pos-sel-op' + (elegida ? ' on' : '')} onClick={() => elegir(o)}>
                <span className="pos-sel-glifo">{o.icono ? <Icon name={o.icono} size={18} /> : o.glifo}</span>
                <span className="pos-sel-op-txt">
                  <b>{o.nombre}</b>
                  {o.detalle && <small>{o.detalle}</small>}
                </span>
                <Icon name="check" size={18} className="pos-sel-check" />
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
