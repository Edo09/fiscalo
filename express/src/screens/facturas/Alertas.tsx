// Los avisos del inicio de Facturas (anexo 6.2): a lo sumo dos filas de 48 px y, si hay más, «+N avisos». Qué avisos son, en qué orden y con qué texto, lo decide `calcularAlertas`
// (lib/alertas.ts); aquí solo se dibujan. Cada fila lleva a donde se resuelve su aviso (su `hash`: la lista filtrada que lo explica, o la pantalla de Numeración) y
// por eso es un botón que pasa por `navegar`, no un enlace: el router marca cada entrada del historial que crea, y un `href` crudo dejaría una sin marca (router.ts).
// El tono pinta la fila y el icono lo acompaña: el color nunca va solo. «+N avisos» no es una fila que se toca: no hay una pantalla que junte los avisos que no caben,
// y se resuelven de a uno, empezando por los de arriba.
import type { Alerta } from '~/lib/alertas'
import { navegar, parseHash } from '~/router'
import { precargarRuta } from '~/screens/registro'
import { Icon } from '~/ui/Icon'

export function Alertas(p: { visibles: Alerta[]; extra: number }): JSX.Element | null {
  const { visibles, extra } = p
  if (visibles.length === 0) return null
  return (
    <ul className="alertas">
      {visibles.map((alerta) => {
        const destino = parseHash(alerta.hash)
        return (
          <li key={alerta.clave}>
            {/* El `pointerdown` baja el trozo de la pantalla de destino antes de que el dedo suba (Numeración será una pantalla perezosa). */}
            <button type="button" className={`alerta alerta--${alerta.tono}`} onPointerDown={() => precargarRuta(destino.id)} onClick={() => navegar(destino)}>
              <Icon name={alerta.icono} size={20} />
              <span className="alerta__texto">{alerta.texto}</span>
              <Icon name="chevron-right" size={20} />
            </button>
          </li>
        )
      })}
      {extra > 0 && (
        <li className="alertas__mas">
          +{extra} {extra === 1 ? 'aviso' : 'avisos'}
        </li>
      )}
    </ul>
  )
}
