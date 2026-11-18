// Filtros de la tabla de cobros: búsqueda por nombre del cliente, estado (chips), cliente, periodo y fecha
// de vencimiento. Los valores viven en el store de interfaz. Lo que se ESCRIBE (el nombre, el periodo, las fechas)
// queda en el campo mientras se teclea y solo llega al store lo completo y válido: así cada tecla no dispara una
// consulta, y una fecha a medias ("0002-11-16") o un periodo a medias ("2026-1") no se mandan al servidor, que
// los rechazaría con un error en pantalla.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui'
import { ESTADOS_COBRO, esFechaReal, esPeriodo } from '@/api/schemas/cobros'
import { useAmbitoCobros } from '../ambito'
import { hayFiltros, useCobrosUi } from '../store'

const BUSQUEDA_MS = 350

/**
 * Un campo de filtro que se escribe a pedazos. Devuelve [texto, cambiar]: el texto es lo que se ve en el campo, y
 * `fijar` (que llega al store) solo se llama con un valor vacío o que pasa `valido`. Si el store cambia por
 * fuera (Limpiar filtros), el campo lo sigue.
 */
function useCampoFiltro(valor: string, valido: (s: string) => boolean, fijar: (s: string) => void): [string, (s: string) => void] {
  const [texto, setTexto] = useState(valor)
  // Lo último que este campo mandó al store: si `valor` es otro, el cambio vino de fuera.
  const fijado = useRef(valor)
  useEffect(() => {
    if (valor !== fijado.current) {
      fijado.current = valor
      setTexto(valor)
    }
  }, [valor])
  const cambiar = (s: string) => {
    setTexto(s)
    if ((s === '' || valido(s)) && s !== fijado.current) {
      fijado.current = s
      fijar(s)
    }
  }
  return [texto, cambiar]
}

export function FiltrosCobros({ buscando }: { buscando: boolean }) {
  const { textos } = useAmbitoCobros()
  const filtros = useCobrosUi((s) => s.filtros)
  const setFiltros = useCobrosUi((s) => s.setFiltros)
  const limpiarFiltros = useCobrosUi((s) => s.limpiarFiltros)
  const abrirModal = useCobrosUi((s) => s.abrirModal)

  // La búsqueda: se fija al dejar de teclear (y se vuelve a la página 1 en setFiltros).
  const [texto, setTexto] = useState(filtros.query)
  const consultaFijada = useRef(filtros.query)
  useEffect(() => {
    const t = setTimeout(() => {
      const q = texto.trim()
      if (q !== consultaFijada.current) {
        consultaFijada.current = q
        setFiltros({ query: q })
      }
    }, BUSQUEDA_MS)
    return () => clearTimeout(t)
  }, [texto, setFiltros])
  // "Limpiar filtros" (aquí o en el estado vacío de la tabla) borra la búsqueda del store: la caja la sigue. Sin
  // esto el texto escrito volvía a fijarse a los 350 ms y los filtros "limpiados" reaparecían.
  useEffect(() => {
    if (filtros.query !== consultaFijada.current) {
      consultaFijada.current = filtros.query
      setTexto(filtros.query)
    }
  }, [filtros.query])

  const [periodo, cambiarPeriodo] = useCampoFiltro(filtros.periodo, esPeriodo, (periodo) => setFiltros({ periodo }))
  // Un rango al revés ("desde" después de "hasta") el servidor lo rechaza: no se manda hasta que tenga sentido.
  const [desde, cambiarDesde] = useCampoFiltro(
    filtros.venceDesde, (s) => esFechaReal(s) && (filtros.venceHasta === '' || s <= filtros.venceHasta), (venceDesde) => setFiltros({ venceDesde }),
  )
  const [hasta, cambiarHasta] = useCampoFiltro(
    filtros.venceHasta, (s) => esFechaReal(s) && (filtros.venceDesde === '' || s >= filtros.venceDesde), (venceHasta) => setFiltros({ venceHasta }),
  )

  const limpiar = () => { limpiarFiltros() }

  return (
    <>
      <div className="toolbar">
        <form
          className="search-input"
          onSubmit={(e) => {
            e.preventDefault()
            const q = texto.trim()
            consultaFijada.current = q
            setFiltros({ query: q })
          }}
        >
          <Icon name={buscando ? 'loader' : 'search'} className={buscando ? 'spin' : undefined} />
          <input
            placeholder={textos.placeholderFiltro} value={texto} onChange={(e) => setTexto(e.target.value)}
            aria-label="Buscar cobros por nombre del cliente"
          />
        </form>
        <button
          type="button" className={'filter-chip' + (filtros.estado === '' ? ' active' : '')}
          onClick={() => setFiltros({ estado: '' })}
        >
          Todos
        </button>
        {ESTADOS_COBRO.map((e) => (
          <button
            key={e} type="button" className={'filter-chip' + (filtros.estado === e ? ' active' : '')}
            onClick={() => setFiltros({ estado: filtros.estado === e ? '' : e })}
          >
            {e}
          </button>
        ))}
      </div>

      <div className="toolbar" style={{ marginTop: -6 }}>
        {filtros.clientId !== null ? (
          <button
            type="button" className="filter-chip active" title="Quitar el filtro de cliente"
            onClick={() => setFiltros({ clientId: null, clienteNombre: '' })}
          >
            <Icon name="user" />{filtros.clienteNombre || textos.filtroSinNombre(filtros.clientId)}<Icon name="x" />
          </button>
        ) : (
          <button type="button" className="filter-chip" onClick={() => abrirModal({ tipo: 'filtrar-cliente' })}>
            <Icon name="user" />{textos.chipCliente}
          </button>
        )}
        <label className="row gap-sm text-sm muted">
          Periodo
          <input
            className="input" type="month" style={{ width: 150, padding: '5px 8px' }} value={periodo}
            placeholder="AAAA-MM" pattern="\d{4}-\d{2}" maxLength={7}
            onChange={(e) => cambiarPeriodo(e.target.value)} aria-label="Filtrar por periodo (AAAA-MM)"
          />
        </label>
        <label className="row gap-sm text-sm muted">
          Vence desde
          <input
            className="input" type="date" style={{ width: 150, padding: '5px 8px' }} value={desde}
            max={filtros.venceHasta || undefined}
            onChange={(e) => cambiarDesde(e.target.value)} aria-label="Vence desde"
          />
        </label>
        <label className="row gap-sm text-sm muted">
          hasta
          <input
            className="input" type="date" style={{ width: 150, padding: '5px 8px' }} value={hasta}
            min={filtros.venceDesde || undefined}
            onChange={(e) => cambiarHasta(e.target.value)} aria-label="Vence hasta"
          />
        </label>
        {hayFiltros(filtros) && (
          <button type="button" className="filter-chip" onClick={limpiar}><Icon name="x" />Limpiar filtros</button>
        )}
      </div>
    </>
  )
}
