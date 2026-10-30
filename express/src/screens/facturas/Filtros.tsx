// Las filas de chips de Facturas (anexo 6.2): el estado (Todas, Pendientes, Por revisar, Aceptadas) y, solo en una cuenta con varios tipos de venta, el tipo de comprobante.
// Qué chips hay y qué valor lleva cada uno lo decide la pantalla (Facturas.tsx: de ahí sale también el texto de «No hay facturas en ...»); aquí solo se dibujan.
// Cada fila es un grupo de radios de verdad (la misma técnica de ui/SegmentedControl): el lector de pantalla lo lee como grupo con su nombre, las flechas del teclado cambian
// de chip sin código nuestro y tocar el chip elegido no hace nada. Miden 48 px y la fila se desplaza en horizontal cuando no caben: el chip elegido se ve por el fondo,
// el borde, la negrita y una marca de verificación, nunca solo por el color.
import { useId } from 'react'
import { Icon } from '~/ui/Icon'

export interface OpcionDeFiltro {
  /** Lo que se escribe en el hash (`estado` o `tipo`); vacío es «sin filtro». */
  valor: string
  etiqueta: string
}

export interface GrupoDeFiltro {
  /** El nombre del grupo para un lector de pantalla («Estado», «Tipo de comprobante»). */
  nombre: string
  opciones: OpcionDeFiltro[]
  valor: string
  onCambio(valor: string): void
}

function Grupo(p: GrupoDeFiltro): JSX.Element {
  const { nombre, opciones, valor, onCambio } = p
  const grupo = useId() // los radios de un grupo comparten `name`
  return (
    <div className="filtros" role="radiogroup" aria-label={nombre}>
      {opciones.map((opcion) => {
        const elegida = opcion.valor === valor
        return (
          <label key={opcion.valor} className="chip">
            <input type="radio" className="chip__radio sr-only" name={grupo} value={opcion.valor} checked={elegida} onChange={() => onCambio(opcion.valor)} />
            <span className="chip__etiqueta">
              {elegida && <Icon name="check" size={16} />}
              {opcion.etiqueta}
            </span>
          </label>
        )
      })}
    </div>
  )
}

export function Filtros(p: { grupos: GrupoDeFiltro[] }): JSX.Element {
  return (
    <>
      {p.grupos.map((grupo) => (
        <Grupo key={grupo.nombre} {...grupo} />
      ))}
    </>
  )
}
