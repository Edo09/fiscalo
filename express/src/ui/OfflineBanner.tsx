// La franja «Sin conexión» (anexo 8): arriba del contenido cuando el aparato cree que no tiene red (`useEnLinea`: `navigator.onLine` y sus eventos). Que diga que
// sí hay red no prueba que algo llegue a internet: las lecturas lentas se avisan aparte («Tarda más de lo normal»). Tiene el icono `wifi-off` y el texto: el
// color nunca va solo. La región de anuncio existe siempre, vacía, y la franja entra dentro de ella: un lector de pantalla solo anuncia lo que cambia en una
// región que ya estaba.
import { useEnLinea } from '~/net/enLinea'
import { Icon } from './Icon'
import './OfflineBanner.css'

export function OfflineBanner(): JSX.Element {
  const enLinea = useEnLinea()
  return (
    <div role="status">
      {!enLinea && (
        <div className="sin-conexion">
          <Icon name="wifi-off" size={20} />
          <span>Sin conexión</span>
        </div>
      )}
    </div>
  )
}
