// «Datos DGII y QR» (anexo 6.3): el recibo de la factura aceptada como tarjeta, para mostrárselo al comprador desde el teléfono. Solo de lo que la DGII aceptó (la pantalla la dibuja si `accionesDe` dice
// `mostrarDatosDgii`) y plegada: los datos del recibo (GET /pdf?format=datos&formato=pos) se piden al abrirla. El QR llega como imagen en `timbre.qr` (no hay librería de QR) y se dibuja a 26 mm. La
// tarjeta es de papel blanco también en el tema oscuro: un QR sobre fondo oscuro no lo lee ningún lector.
import { useQuery } from '@tanstack/react-query'
import { FRESCURA } from '@/config/cache'
import type { Ambiente } from '~/entitlements'
import type { FacturaVista } from '~/lib/filas'
import { claves, getReciboDatos } from '~/net/lecturas'
import { Banner } from '~/ui/Banner'
import { Button } from '~/ui/Button'
import { Skeleton } from '~/ui/Skeleton'
import { manejadorDe } from './acciones-registro'
import { Plegable } from './Plegable'
import './DatosDgii.css'

const AMBIENTES: Record<Ambiente, string> = { ecf: 'Producción', certecf: 'Certificación', testecf: 'Pruebas' }

interface Timbre {
  /** La imagen del QR como data URI; null si no llegó una imagen que se pueda dibujar. */
  qr: string | null
  fechaFirma: string
  codigoSeguridad: string
}

const campo = (v: unknown, clave: string): unknown => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[clave] : undefined)
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** El timbre de lo que mandó el API (`unknown`): lo que no llega queda vacío. Solo se dibuja una imagen PNG o JPG en data URI, nunca un enlace. */
function leerTimbre(recibo: unknown): Timbre {
  const timbre = campo(recibo, 'timbre')
  const qr = texto(campo(timbre, 'qr'))
  return {
    qr: /^data:image\/(png|jpe?g);base64,/i.test(qr) ? qr : null,
    fechaFirma: texto(campo(timbre, 'fecha_firma')),
    codigoSeguridad: texto(campo(timbre, 'codigo_seguridad')),
  }
}

function Contenido(p: { f: FacturaVista; ambiente: Ambiente | null }): JSX.Element {
  const { f, ambiente } = p
  const recibo = useQuery({ queryKey: claves.recibo(f.id), queryFn: () => getReciboDatos(f.id), staleTime: FRESCURA.NORMAL })
  const copiar = manejadorDe('copiarNcf')

  if (recibo.data === undefined) {
    if (recibo.isError) {
      return (
        <Banner tono="danger" accion={{ etiqueta: 'Reintentar', onClick: () => void recibo.refetch() }}>
          No se pudieron cargar los datos de la DGII.
        </Banner>
      )
    }
    return (
      <div aria-busy="true">
        <Skeleton alto={32} filas={4} />
      </div>
    )
  }

  const timbre = leerTimbre(recibo.data)
  const filas: [string, string][] = [
    ['e-NCF', f.eNcf ?? ''],
    ['Seguimiento', f.trackId ?? ''],
    ['Cód. seguridad', f.codigoSeguridad ?? timbre.codigoSeguridad],
    ['Firmada', timbre.fechaFirma],
    ['Ambiente', ambiente === null ? '' : AMBIENTES[ambiente]],
  ]
  return (
    <>
      <div className="datos-dgii__papel">
        <dl className="datos-dgii__filas">
          {filas
            .filter(([, valor]) => valor !== '')
            .map(([etiqueta, valor]) => (
              <div key={etiqueta} className="datos-dgii__fila">
                <dt>{etiqueta}</dt>
                <dd>{valor}</dd>
              </div>
            ))}
        </dl>
        {timbre.qr !== null && <img className="datos-dgii__qr" src={timbre.qr} alt="Código QR de la DGII" width={98} height={98} />}
      </div>
      {copiar !== undefined && f.eNcf !== null && (
        <div className="datos-dgii__copiar">
          <Button variante="secundario" icono="copy" bloque onClick={() => void copiar(f)}>
            Copiar e-NCF
          </Button>
        </div>
      )}
    </>
  )
}

export function DatosDgii(p: { f: FacturaVista; ambiente: Ambiente | null }): JSX.Element {
  return (
    <Plegable titulo="Datos DGII y QR">
      <Contenido f={p.f} ambiente={p.ambiente} />
    </Plegable>
  )
}
