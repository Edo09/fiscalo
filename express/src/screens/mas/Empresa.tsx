// Mi empresa (anexo 6.11): los datos fiscales de la empresa y el estado de su certificado, de solo lectura. Cambiarlos es cosa de soporte: aquí no se edita nada.
// La pantalla es de `#/mas/empresa`; el shell le pasa su ruta como propiedad (no la usa) y la guardia de rutas ya pidió el módulo `configuracion`.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/api/errores'
import { FRESCURA } from '@/config/cache'
import { SOPORTE_WHATSAPP } from '~/config'
import { formatoRnc, normalizarEmisor, textoCertificado } from '~/lib/empresa'
import { clavesEmpresa, getEmisor } from '~/net/empresa'
import { Banner } from '~/ui/Banner'
import { Cabecera } from '~/ui/Cabecera'
import { Skeleton } from '~/ui/Skeleton'
import './pantallas-mas.css'

/** Un dato de la lista; no sale si no hay valor. */
function Dato(p: { etiqueta: string; valor: string | null }): JSX.Element | null {
  if (p.valor === null || p.valor === '') return null
  return (
    <div className="datos__fila">
      <dt className="datos__etiqueta">{p.etiqueta}</dt>
      <dd className="datos__valor">{p.valor}</dd>
    </div>
  )
}

export default function Empresa(): JSX.Element {
  const consulta = useQuery({ queryKey: clavesEmpresa.emisor, queryFn: getEmisor, staleTime: FRESCURA.VOLATIL })
  const empresa = useMemo(() => normalizarEmisor(consulta.data), [consulta.data])
  const certificado = empresa?.certificado == null ? null : textoCertificado(empresa.certificado)
  const lugar = empresa === null ? '' : [empresa.municipio, empresa.provincia].filter((x): x is string => x !== null).join(', ')
  const soporte =
    SOPORTE_WHATSAPP === '' || empresa === null
      ? null
      : `https://wa.me/${SOPORTE_WHATSAPP}?text=${encodeURIComponent(`Hola, soy de ${empresa.razonSocial}. Quiero cambiar los datos de mi empresa.`)}`

  let cuerpo: JSX.Element
  if (consulta.isPending) {
    cuerpo = <Skeleton alto={56} filas={6} />
  } else if (consulta.isError || empresa === null) {
    // El API explica por sí mismo lo que pasa (p. ej. «Tu empresa todavía no tiene sus datos fiscales configurados»): se muestra su texto.
    const texto = consulta.error instanceof ApiError ? consulta.error.message : 'No se pudieron cargar los datos de tu empresa.'
    cuerpo = (
      <Banner tono="danger" accion={{ etiqueta: 'Reintentar', onClick: () => void consulta.refetch() }}>
        {texto}
      </Banner>
    )
  } else {
    cuerpo = (
      <>
        {certificado !== null && (
          <Banner tono={certificado.tono === 'neutral' ? 'info' : certificado.tono} titulo="Certificado digital">
            {certificado.texto}
          </Banner>
        )}
        <dl className="datos">
          <Dato etiqueta="Razón social" valor={empresa.razonSocial} />
          <Dato etiqueta="RNC" valor={formatoRnc(empresa.rnc)} />
          <Dato etiqueta="Nombre comercial" valor={empresa.nombreComercial} />
          <Dato etiqueta="Sucursal" valor={empresa.sucursal} />
          <Dato etiqueta="Dirección" valor={empresa.direccion} />
          <Dato etiqueta="Municipio y provincia" valor={lugar} />
          <Dato etiqueta="Teléfono" valor={empresa.telefono} />
          <Dato etiqueta="Correo" valor={empresa.correo} />
          <Dato etiqueta="Sitio web" valor={empresa.web} />
          <Dato etiqueta="Actividad económica" valor={empresa.actividad} />
        </dl>
        <p className="mas-pantalla__nota">Para cambiar estos datos escribe a soporte.</p>
        {soporte !== null && (
          <a className="boton boton--secundario boton--bloque" href={soporte} target="_blank" rel="noopener noreferrer">
            Abrir WhatsApp
          </a>
        )}
      </>
    )
  }

  return (
    <div className="pantalla">
      <Cabecera titulo="Mi empresa" atras="historial" />
      <div className="mas-pantalla" aria-busy={consulta.isPending || undefined}>
        {cuerpo}
      </div>
    </div>
  )
}
