// Paso 3 del asistente de venta, «Revisar y emitir» (anexo 6.6): lo que se va a emitir, a la vista, y el botón que lo emite. No hay otra confirmación: el tipo, el comprador, las
// líneas, el total y el aviso de que no se deshace están en pantalla, y el botón dice el tipo y el total.
//  - El resumen: el cliente (con «Cambiar»), las líneas (más de 3 se pliegan), los totales por tasa con las cuentas del servidor, el pago (contado, o crédito con su plazo y su fecha
//    límite cuando el comprobante y el cliente lo permiten) y el aviso. La fecha de emisión no se elige: la pone el servidor.
//  - Los errores (lib/reglas) se listan con su texto; tocar uno lleva al paso donde se corrige. El botón nunca se deshabilita en silencio: `estadoBotonEmitir` le da un rótulo a cada estado.
//  - Emitir: un solo envío a la vez, y el registro se escribe antes del POST (screens/facturar/useWizard `emitirAhora`). Mientras haya un envío sin confirmar el botón no emite: manda a
//    revisar Facturas y deja «Ya revisé: no se emitió» (con confirmación), que es lo único que lo suelta. Si el servidor no guardó nada (validación, plan), la persona vuelve aquí con
//    su texto en un aviso.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FRESCURA } from '@/config/cache'
import { tiposVenta } from '~/entitlements'
import { fechaLimiteEfectiva, PLAZO_POR_DEFECTO } from '~/lib/carrito'
import { rd } from '~/lib/dinero'
import { bloqueaEmision } from '~/lib/envio'
import { etiquetaAmbiente } from '~/lib/etiquetas'
import { fmtFechaISO } from '~/lib/fechas'
import { estadoBotonEmitir, rangoVigenteDe, validarRevision } from '~/lib/reglas'
import type { EntradaRevision, ErrorCampo } from '~/lib/reglas'
import { hoy } from '~/lib/reloj'
import { nombreTipo, permiteCredito } from '~/lib/tiposEcf'
import { resumenTotales } from '~/lib/totales'
import { admiteDecimales, useUnidades } from '~/lib/unidades'
import { useEnLinea } from '~/net/enLinea'
import { claves, getStatsLight } from '~/net/lecturas'
import { navegar } from '~/router'
import { Banner } from '~/ui/Banner'
import { Button } from '~/ui/Button'
import { Cabecera } from '~/ui/Cabecera'
import { ConfirmSheet } from '~/ui/ConfirmSheet'
import { Icon } from '~/ui/Icon'
import { SegmentedControl } from '~/ui/SegmentedControl'
import { StickyActionBar } from '~/ui/StickyActionBar'
import { DateField } from '~/ui/TextField'
import { formatearRnc } from './ayudas'
import { PasoCargando, PasoDerecha } from './Paso'
import { confirmarNoSeEmitio, emitirAhora, iniciarWizard, useCuenta, useWizardStore, wizard } from './useWizard'
import './PasoRevisar.css'

/** Cuántas líneas se ven antes de «Ver las N líneas». */
const LINEAS_VISIBLES = 3

/** Los códigos del servidor que dicen que esta cuenta no puede emitir este comprobante. */
const SIN_PLAN = ['TIPO_NO_HABILITADO', 'EDICION_NO_INCLUYE']

const PLAZOS = ['15', '30', '45', '60'].map((d) => ({ valor: d, etiqueta: `${d} días` }))
const PAGOS: { valor: 'contado' | 'credito'; etiqueta: string }[] = [
  { valor: 'contado', etiqueta: 'Contado' },
  { valor: 'credito', etiqueta: 'Crédito' },
]

/** Por qué el botón no deja emitir, en una frase, para los estados en que no se puede hacer nada desde aquí. */
const RAZON_DEL_BOTON: Partial<Record<ReturnType<typeof estadoBotonEmitir>['kind'], string>> = {
  sinConexion: 'Cuando vuelva la señal podrás emitir. Tu factura está guardada.',
  sinRango: 'Un administrador tiene que registrar un rango en Más, Numeración.',
  planNoIncluye: 'Tu plan Express no incluye este comprobante.',
}

export default function PasoRevisar(): JSX.Element {
  const { entitlements, u, admin } = useCuenta()
  const carrito = useWizardStore((s) => s.carrito)
  const enviando = useWizardStore((s) => s.enviando)
  const envio = useWizardStore((s) => s.envio)
  const errorEnvio = useWizardStore((s) => s.errorEnvio)
  const enLinea = useEnLinea()
  const { catalogo } = useUnidades()

  const tiposClave = tiposVenta(entitlements).join(',')
  const tipos = useMemo(() => (tiposClave === '' ? [] : tiposClave.split(',')), [tiposClave])
  useEffect(() => {
    if (u !== null) iniciarWizard(u, tipos)
  }, [u, tipos])

  // Las estadísticas dicen si queda numeración vigente: las mismas que usa Facturas (misma clave, misma caché).
  const stats = useQuery({ queryKey: claves.stats, queryFn: getStatsLight, staleTime: FRESCURA.VOLATIL, enabled: enLinea })

  const [verTodas, setVerTodas] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const pagoRef = useRef<HTMLDivElement>(null)

  if (carrito === null || entitlements === null) return <PasoCargando titulo="Revisar" />

  const hoyLocal = hoy()
  const { tipo, cliente, lineas } = carrito
  const sinPlan = errorEnvio?.codigo !== undefined && errorEnvio.codigo !== null && SIN_PLAN.includes(errorEnvio.codigo)
  const entrada: EntradaRevision = {
    carrito,
    hoy: hoyLocal,
    rncEmisor: entitlements.tenant.rnc,
    admiteDecimales: (unidad) => admiteDecimales(unidad, catalogo),
    unidadValida: (unidad) => unidad !== '' && (catalogo.length === 0 || catalogo.some((x) => String(x.id) === unidad)),
    enLinea,
    rangoVigente: rangoVigenteDe(stats.data, tipo, entitlements.tenant.ambiente, hoyLocal),
    tipoHabilitado: !sinPlan,
    envioEnCurso: enviando || envio?.fase === 'enviando',
    envioSinConfirmar: bloqueaEmision(envio),
  }
  const errores = validarRevision(entrada)
  const boton = estadoBotonEmitir(entrada)
  const totales = resumenTotales(lineas)
  const ambiente = entitlements.tenant.ambiente
  const creditoPosible = permiteCredito(tipo) && cliente !== null && cliente.permiteCredito
  const fechaLimite = fechaLimiteEfectiva(carrito, hoyLocal)

  /** Lleva al paso donde se corrige el error: el cliente, al primero; las líneas, al segundo; el pago está en esta pantalla. */
  const corregir = (e: ErrorCampo): void => {
    if (e.campo === 'cliente') navegar({ id: 'facturar' })
    else if (e.campo === 'pago') pagoRef.current?.scrollIntoView({ block: 'center' })
    else navegar({ id: 'facturar-productos' })
  }
  const emitir = (): void => {
    if (u !== null) void emitirAhora({ u, idempotencia: entitlements.capacidades.idempotencia })
  }
  const alBoton = (): void => {
    switch (boton.kind) {
      case 'listo':
        emitir()
        break
      case 'corregir':
        if (errores.length > 0) corregir(errores[0])
        break
      case 'enCurso':
        if (envio !== null) navegar({ id: 'facturar-resultado', clave: envio.clave })
        break
      case 'sinConfirmar':
        navegar({ id: 'facturas' })
        break
      default:
        break
    }
  }
  const nombreDeLinea = (id: number | undefined): string => {
    const l = lineas.find((x) => x.id === id)
    return l === undefined ? '' : l.nombre.trim() === '' ? 'Línea sin nombre' : l.nombre
  }
  const habilitado = boton.kind === 'listo' || boton.kind === 'corregir' || boton.kind === 'enCurso' || boton.kind === 'sinConfirmar'
  const lineasVisibles = verTodas || lineas.length <= LINEAS_VISIBLES ? lineas : lineas.slice(0, LINEAS_VISIBLES)

  return (
    <div className="pantalla paso">
      <Cabecera titulo="Revisar" atras={{ id: 'facturar-productos' }} derecha={<PasoDerecha paso={3} />} />
      <div className="paso__cuerpo">
        {ambiente !== 'ecf' && <p className="pr-pruebas">{ambiente === 'certecf' ? `MODO PRUEBAS · ${etiquetaAmbiente(ambiente).texto}` : 'MODO PRUEBAS'}</p>}

        {errorEnvio !== null && (
          <Banner tono="danger" titulo={sinPlan ? `Tu plan no incluye E${tipo}` : errorEnvio.codigo === 'CERT_VENCIDO' ? 'Tu certificado venció' : 'No se emitió la factura'}>
            {errorEnvio.mensaje}
            {errorEnvio.codigo === 'RANGO_NO_AUTORIZADO' && admin && (
              <>
                {' '}
                <button type="button" className="pr-enlace" onClick={() => navegar({ id: 'mas-numeracion' })}>
                  Ir a Numeración
                </button>
              </>
            )}
          </Banner>
        )}

        <p className="paso__tipo">
          Factura {nombreTipo(tipo)} (E{tipo})
        </p>

        <div className="paso__tarjeta pr-cliente">
          <div className="pr-cliente__texto">
            <p className="pr-cliente__nombre">{cliente !== null ? cliente.nombre : 'Consumidor final'}</p>
            {cliente?.rnc != null && <p className="pr-cliente__detalle">RNC {formatearRnc(cliente.rnc)}</p>}
          </div>
          <Button variante="texto" onClick={() => navegar({ id: 'facturar' })}>
            {cliente !== null ? 'Cambiar' : 'Agregar cliente'}
          </Button>
        </div>

        <div className="paso__tarjeta">
          <ul className="pr-lineas">
            {lineasVisibles.map((l) => (
              <li key={l.id} className="pr-linea">
                <span className="pr-linea__texto">
                  {l.cant} × {l.nombre.trim() === '' ? 'Línea sin nombre' : l.nombre}
                </span>
                <span className="pr-linea__importe">{rd(totales.lineas[lineas.indexOf(l)].importe)}</span>
              </li>
            ))}
          </ul>
          {lineas.length > LINEAS_VISIBLES && (
            <Button variante="texto" bloque onClick={() => setVerTodas((v) => !v)}>
              {verTodas ? 'Ver menos' : `Ver las ${lineas.length} líneas`}
            </Button>
          )}
          <p className="pr-nota">Precios sin ITBIS: el ITBIS se suma abajo.</p>
        </div>

        <div className="paso__tarjeta pr-totales">
          <div className="pr-total">
            <span>Subtotal</span>
            <span>{rd(totales.subtotal)}</span>
          </div>
          {totales.descuentos > 0 && (
            <div className="pr-total">
              <span>Descuento</span>
              <span>-{rd(totales.descuentos)}</span>
            </div>
          )}
          {totales.itbisPorTasa.map((t) => (
            <div key={t.indFact} className="pr-total">
              <span>{t.etiqueta}</span>
              <span>{rd(t.monto)}</span>
            </div>
          ))}
          <div className="pr-total pr-total--final">
            <span>TOTAL</span>
            <span>{rd(totales.total)}</span>
          </div>
        </div>

        <div className="pr-pago" ref={pagoRef}>
          <p className="pr-pago__etiqueta">Pago</p>
          {creditoPosible ? (
            <SegmentedControl
              etiquetaGrupo="Forma de pago"
              opciones={PAGOS}
              valor={carrito.pago}
              onCambio={(v) => wizard.elegirPago(v === 'credito' ? { pago: 'credito', plazoDias: carrito.plazoDias || PLAZO_POR_DEFECTO } : { pago: 'contado' })}
            />
          ) : (
            <p className="pr-pago__texto">
              Contado.{' '}
              {tipo === '32'
                ? 'Las facturas de consumo son de contado.'
                : cliente === null
                  ? 'Elige un cliente para vender a crédito.'
                  : !cliente.permiteCredito
                    ? 'Este cliente es solo de contado.'
                    : ''}
            </p>
          )}
          {creditoPosible && carrito.pago === 'credito' && (
            <>
              <SegmentedControl
                etiquetaGrupo="Plazo de pago"
                opciones={PLAZOS}
                valor={carrito.fechaLimite === null ? String(carrito.plazoDias) : ''}
                onCambio={(v) => wizard.elegirPago({ pago: 'credito', plazoDias: Number(v) })}
              />
              <p className="pr-pago__texto">Vence {fmtFechaISO(fechaLimite)}</p>
              <DateField
                etiqueta="Fecha límite de pago"
                valor={fechaLimite}
                min={hoyLocal}
                onCambio={(v) => wizard.elegirPago(v === '' ? { pago: 'credito', plazoDias: carrito.plazoDias } : { pago: 'credito', fechaLimite: v })}
              />
            </>
          )}
        </div>

        <p className="pr-fecha">Fecha: la fija el servidor</p>
        <Banner tono="info">Se envía a la DGII. Solo se anula con nota de crédito.</Banner>

        {errores.length > 0 && (
          <div className="pr-errores" role="alert">
            <p className="pr-errores__titulo">
              <Icon name="triangle-alert" /> {errores.length} {errores.length === 1 ? 'cosa' : 'cosas'} por corregir
            </p>
            <ul className="pr-errores__lista">
              {errores.map((e, i) => (
                <li key={`${e.campo}-${e.linea ?? 0}-${i}`}>
                  <button type="button" className="pr-error" onClick={() => corregir(e)}>
                    <span>
                      {e.linea !== undefined && <strong>{nombreDeLinea(e.linea)}: </strong>}
                      {e.mensaje}
                    </span>
                    <Icon name="chevron-right" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <StickyActionBar>
        <Button
          bloque
          variante={boton.kind === 'sinConfirmar' ? 'secundario' : 'primario'}
          disabled={!habilitado}
          razon={habilitado ? undefined : RAZON_DEL_BOTON[boton.kind]}
          onClick={alBoton}
        >
          {boton.etiqueta}
        </Button>
        {boton.kind === 'sinConfirmar' && (
          <Button variante="texto" bloque onClick={() => setConfirmando(true)}>
            Ya revisé: no se emitió
          </Button>
        )}
      </StickyActionBar>

      <ConfirmSheet
        abierto={confirmando}
        pregunta="¿La factura no se emitió?"
        consecuencia="Búscala en Facturas antes de confirmar. Si aparece allí, no la emitas otra vez."
        etiquetaAccion="Ya revisé: no se emitió"
        onConfirmar={() => {
          if (u !== null) confirmarNoSeEmitio(u)
          setConfirmando(false)
        }}
        onCancelar={() => setConfirmando(false)}
      />
    </div>
  )
}
