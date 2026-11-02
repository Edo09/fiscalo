// El resultado de una emisión (anexo 6.7): `#/facturar/resultado/{clave}`. La pantalla la maneja el registro de envío (lib/envio), que se escribe antes del POST y se actualiza con lo
// que contesta el servidor, así que sobrevive a recargar la página y a salir del asistente: lo que cambia el registro cambia lo que se ve, sin hacer nada más.
//  - Aceptada, en proceso, rechazada y no encontrada: la factura existe; «Ver factura» abre su detalle (`#/facturas/{id}`).
//  - Guardada sin confirmar, o sin saber si se guardó (la señal se cortó): dice «No la vuelvas a emitir» y NO ofrece una factura nueva; el borrador se queda y Revisar no deja emitir
//    hasta que la persona confirme que no se emitió. «Verificar ahora» le pregunta a la DGII cómo va la factura.
//  - Sin un registro con esta clave (una dirección vieja, o un registro que ya se soltó) no hay nada que mostrar: «No encontramos ese resultado».
// Lo que se dice sale de `vistaDeEnvio` (lib/envio, con sus pruebas): aquí solo se dibuja y se lleva cada acción a su sitio.
import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '@/api/errores'
import { tiposVenta } from '~/entitlements'
import { vistaDeEnvio } from '~/lib/envio'
import type { AccionId, EnvioRecord, TonoResultado } from '~/lib/envio'
import { navegar } from '~/router'
import type { Ruta } from '~/router'
import { Button } from '~/ui/Button'
import { Cabecera } from '~/ui/Cabecera'
import { EmptyState } from '~/ui/EmptyState'
import { Icon } from '~/ui/Icon'
import type { IconName } from '~/ui/Icon'
import { mostrarToast } from '~/ui/Toast'
import { PasoCargando } from './Paso'
import { descartarBorrador, iniciarWizard, soltarEnvio, useCuenta, useWizardStore, verificarEnvio } from './useWizard'
import './Resultado.css'

const ICONO: Record<TonoResultado, IconName> = { ok: 'circle-check', info: 'clock', warning: 'triangle-alert', danger: 'circle-x', neutral: 'circle-help' }

/** Los segundos que lleva un envío en vuelo, al día cada segundo mientras `activo`. */
function useSegundos(desde: number, activo: boolean): number {
  const [segundos, setSegundos] = useState(() => Math.max(0, Math.floor((Date.now() - desde) / 1000)))
  useEffect(() => {
    if (!activo) return
    const actualizar = (): void => setSegundos(Math.max(0, Math.floor((Date.now() - desde) / 1000)))
    actualizar()
    const reloj = window.setInterval(actualizar, 1000)
    return () => window.clearInterval(reloj)
  }, [desde, activo])
  return segundos
}

/** La tarjeta de un registro con la clave de la ruta: su título, lo que se sabe de la factura, lo que se explica y las acciones. */
function Tarjeta(p: { envio: EnvioRecord; u: { tenantId: number; userId: number } | null }): JSX.Element {
  const { envio, u } = p
  const enviando = envio.fase === 'enviando'
  const segundos = useSegundos(envio.creadoEn, enviando)
  const [verificando, setVerificando] = useState(false)
  const vista = vistaDeEnvio(envio, segundos)

  const verificar = async (): Promise<void> => {
    if (u === null) return
    setVerificando(true)
    try {
      if (!(await verificarEnvio(u))) mostrarToast('Todavía sin cambios. Vuelve a verificar en unos minutos.')
    } catch (e) {
      // Solo un ApiError trae un texto para el usuario; el de un error de JavaScript no se le enseña a nadie, pero queda en la consola.
      if (e instanceof ApiError) mostrarToast(e.message, { tipo: 'error' })
      else console.error('[verificar]', e)
    } finally {
      setVerificando(false)
    }
  }

  /**
   * Lleva cada acción a su sitio. Mirar la factura o Facturas deja el registro (volver con el atrás muestra otra vez este resultado); empezar otra cosa (una factura nueva, corregir
   * esta, volver a editar) lo suelta, y así Revisar no lo toma por un envío pendiente. Uno sin confirmar nunca se suelta aquí: sigue impidiendo emitir (`soltarEnvio`).
   */
  const hacer = (id: AccionId): void => {
    const soltar = (): void => {
      if (u !== null) soltarEnvio(u)
    }
    switch (id) {
      case 'verificar':
        void verificar()
        break
      case 'verFactura':
        if (envio.facturaId !== undefined) navegar({ id: 'factura', facturaId: envio.facturaId })
        break
      case 'verFacturas':
        navegar({ id: 'facturas' })
        break
      case 'nueva':
        soltar()
        descartarBorrador()
        navegar({ id: 'facturar' }, { reemplazar: true })
        break
      case 'corregir': // la venta se queda en el borrador: se corrige y se emite como una factura nueva
        soltar()
        navegar({ id: 'facturar' }, { reemplazar: true })
        break
      case 'volverRevisar':
        soltar()
        navegar({ id: 'facturar-revisar' }, { reemplazar: true })
        break
    }
  }

  return (
    <div className="rs">
      <div className={`rs__icono rs__icono--${vista.tono}`}>{enviando ? <span className="rs__espera" aria-hidden="true" /> : <Icon name={ICONO[vista.tono]} size={40} />}</div>
      <div className="rs__texto" aria-live="polite">
        <h1 className="rs__titulo">{vista.titulo}</h1>
        {vista.datos.map((d, i) => (
          <p key={i} className={i === 0 && vista.datos.length > 1 ? 'rs__dato rs__dato--ncf' : 'rs__dato'}>
            {d}
          </p>
        ))}
        {vista.lineas.map((l) => (
          <p key={l} className={l.startsWith('No la vuelvas') ? 'rs__linea rs__linea--fuerte' : 'rs__linea'}>
            {l}
          </p>
        ))}
        {vista.motivos.length > 0 && (
          <ul className="rs__motivos">
            {vista.motivos.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="rs__acciones">
        {vista.acciones.map((a, i) => (
          <Button
            key={a.id}
            bloque
            variante={a.primaria === true ? 'primario' : i === vista.acciones.length - 1 && a.id !== 'nueva' ? 'texto' : 'secundario'}
            cargando={a.id === 'verificar' && verificando}
            onClick={() => hacer(a.id)}
          >
            {a.etiqueta}
          </Button>
        ))}
      </div>
    </div>
  )
}

export default function Resultado(p: { ruta: Ruta }): JSX.Element {
  const clave = p.ruta.id === 'facturar-resultado' ? p.ruta.clave : ''
  const { entitlements, u } = useCuenta()
  const cargado = useWizardStore((s) => s.carrito !== null)
  const envio = useWizardStore((s) => s.envio)

  const tiposClave = tiposVenta(entitlements).join(',')
  const tipos = useMemo(() => (tiposClave === '' ? [] : tiposClave.split(',')), [tiposClave])
  useEffect(() => {
    if (u !== null) iniciarWizard(u, tipos)
  }, [u, tipos])

  if (!cargado) return <PasoCargando titulo="Resultado" />
  if (envio === null || envio.clave !== clave) {
    return (
      <div className="pantalla paso">
        <Cabecera titulo="Resultado" />
        <EmptyState icono="file-text" titulo="No encontramos ese resultado" texto="Puede que ya lo hayas cerrado. Las facturas que emitiste están en Facturas." accion={{ etiqueta: 'Ver Facturas', onClick: () => navegar({ id: 'facturas' }) }} />
      </div>
    )
  }
  return (
    <div className="pantalla paso">
      <Cabecera titulo="Resultado" />
      <Tarjeta envio={envio} u={u} />
    </div>
  )
}
