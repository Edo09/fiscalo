// Los dos números de arriba de Facturas (anexo 6.2): HOY y ESTE MES, con lo vendido y cuántas facturas fueron. Las cifras salen de las estadísticas ligeras (`tilesDe`,
// lib/alertas.ts, neto de notas de crédito y sin lo rechazado) y esta pieza solo las dibuja, con las cifras en `tabular-nums` para que no bailen al cambiar.
// Tres estados, cada uno con su forma, porque cada sección de la pantalla se dibuja sola (la lista no espera a las estadísticas, que se piden después de su primer pintado):
//  - `cargando`: dos bloques grises del alto de un tile (el esqueleto, que no aparece en los primeros 150 ms), para que cuando llegue la cifra nada salte;
//  - `error`: las dos cifras en «RD$ --» y un «Reintentar». Sin red y sin cifras que mostrar también se ve así;
//  - `listo`: las cifras. Un tile cuya lista de ventas no vino no se dibuja (`tilesDe` da null), y si no vino ninguna no queda nada.
import type { Tile } from '~/lib/alertas'
import { Button } from '~/ui/Button'
import { Skeleton } from '~/ui/Skeleton'

export type EstadoDeTiles = 'cargando' | 'error' | 'listo'

/** El alto de un tile, en px: el del esqueleto, para que el tile que llega ocupe el mismo sitio (Facturas.css fija el mismo `min-height`). */
const ALTO_DEL_TILE = 96

function Caja(p: { rotulo: string; monto: string; cantidad?: string }): JSX.Element {
  const { rotulo, monto, cantidad } = p
  return (
    <div className="tile">
      <p className="tile__rotulo">{rotulo}</p>
      <p className="tile__monto tabular">{monto}</p>
      {cantidad !== undefined && <p className="tile__cantidad">{cantidad}</p>}
    </div>
  )
}

export function Tiles(p: { estado: EstadoDeTiles; tiles: { hoy: Tile | null; mes: Tile | null }; onReintentar(): void }): JSX.Element | null {
  const { estado, tiles, onReintentar } = p

  if (estado === 'cargando') {
    return (
      <div className="tiles" aria-busy="true">
        <Skeleton alto={ALTO_DEL_TILE} />
        <Skeleton alto={ALTO_DEL_TILE} />
      </div>
    )
  }

  if (estado === 'error') {
    return (
      <div className="tiles">
        <Caja rotulo="HOY" monto="RD$ --" />
        <Caja rotulo="ESTE MES" monto="RD$ --" />
        {/* Ocupa las dos columnas; el botón va en un bloque (no en una fila flex), como pide Button. */}
        <div className="tiles__reintentar">
          <Button variante="secundario" bloque onClick={onReintentar}>
            Reintentar
          </Button>
        </div>
      </div>
    )
  }

  if (tiles.hoy === null && tiles.mes === null) return null
  return (
    <div className="tiles">
      {tiles.hoy !== null && <Caja rotulo="HOY" monto={tiles.hoy.monto} cantidad={tiles.hoy.cantidad} />}
      {tiles.mes !== null && <Caja rotulo="ESTE MES" monto={tiles.mes.monto} cantidad={tiles.mes.cantidad} />}
    </div>
  )
}
