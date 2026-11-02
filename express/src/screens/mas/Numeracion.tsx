// Numeración e-CF (anexo 6.12): una tarjeta por tipo de comprobante de la cuenta con su estado (vigente, pocos, por vencer, agotada, sin rango) y, para el administrador, los rangos
// autorizados y el botón «Registrar rango». Quien no es administrador la ve de solo lectura: el estado sale de las estadísticas del inicio, que cualquier cuenta puede pedir.
// Sin un rango vigente la DGII rechaza el comprobante, y por eso esta pantalla existe: aquí es donde un administrador pone el rango que la DGII le autorizó.
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errores'
import { FRESCURA } from '@/config/cache'
import { useSession } from '@/stores/auth'
import { esAdmin, leerEntitlements } from '~/entitlements'
import type { UsuarioExpress } from '~/entitlements'
import { cuerpoRango, tarjetasNumeracion, validarRango } from '~/lib/empresa'
import type { ErroresRango, FormRango } from '~/lib/empresa'
import { tonoNumeracion } from '~/lib/etiquetas'
import { fmtFechaISO } from '~/lib/fechas'
import { hoy } from '~/lib/reloj'
import { snapshot } from '~/lib/sesion'
import { clavesEmpresa, getRangos, registrarRango } from '~/net/empresa'
import { claves, getStatsLight } from '~/net/lecturas'
import { Banner } from '~/ui/Banner'
import { BottomSheet } from '~/ui/BottomSheet'
import { Button } from '~/ui/Button'
import { Cabecera } from '~/ui/Cabecera'
import { SegmentedControl } from '~/ui/SegmentedControl'
import { Skeleton } from '~/ui/Skeleton'
import { DateField, NumericField, TextField } from '~/ui/TextField'
import { mostrarToast } from '~/ui/Toast'
import './pantallas-mas.css'

const miles = (n: number): string => n.toLocaleString('en-US')

/** `secuencias` de las estadísticas ligeras; undefined si no llegaron o no tienen esa forma. */
function secuenciasDe(stats: unknown): unknown {
  return typeof stats === 'object' && stats !== null ? (stats as Record<string, unknown>).secuencias : undefined
}

const FORM_VACIO = (tipo: string): FormRango => ({ tipo, desde: '', hasta: '', vence: '', noSolicitud: '', noAutorizacion: '' })

export default function Numeracion(): JSX.Element {
  const { token, user } = useSession()
  const usuario: UsuarioExpress | null = token !== null && user !== null ? user : (snapshot()?.user ?? null)
  const entitlements = useMemo(() => leerEntitlements(usuario), [usuario])
  const admin = esAdmin(usuario)
  const tipos = useMemo(() => entitlements?.tipos_ecf ?? [], [entitlements])
  const ambiente = entitlements?.tenant.ambiente ?? 'testecf'
  const hoyLocal = hoy()
  const cliente = useQueryClient()

  const stats = useQuery({ queryKey: claves.stats, queryFn: getStatsLight, staleTime: FRESCURA.VOLATIL })
  // Los rangos solo los pide el administrador: el permiso de `ncf` de un facturador no los cubre, y su pantalla no los muestra.
  const rangos = useQuery({ queryKey: clavesEmpresa.rangos, queryFn: getRangos, staleTime: FRESCURA.VOLATIL, enabled: admin })

  const tarjetas = useMemo(
    () => tarjetasNumeracion({ tipos, ambiente, secuencias: secuenciasDe(stats.data), rangos: admin ? rangos.data : undefined, hoy: hoyLocal }),
    [tipos, ambiente, stats.data, rangos.data, admin, hoyLocal],
  )

  // --- «Registrar rango»
  const [abierta, setAbierta] = useState(false)
  const [form, setForm] = useState<FormRango>(FORM_VACIO(tipos[0] ?? ''))
  const [errores, setErrores] = useState<ErroresRango>({})
  const [enviando, setEnviando] = useState(false)
  const [errorServidor, setErrorServidor] = useState<string | null>(null)

  const abrir = (tipo?: string): void => {
    setForm(FORM_VACIO(tipo ?? tipos[0] ?? ''))
    setErrores({})
    setErrorServidor(null)
    setAbierta(true)
  }
  const cambiar = (parche: Partial<FormRango>): void => setForm((f) => ({ ...f, ...parche }))

  const guardar = async (): Promise<void> => {
    const malos = validarRango(form, { hoy: hoyLocal, ambiente, tipos })
    setErrores(malos)
    if (Object.keys(malos).length > 0) return
    setEnviando(true)
    setErrorServidor(null)
    try {
      await registrarRango(cuerpoRango(form))
      mostrarToast('Rango registrado')
      setAbierta(false)
      for (const queryKey of [clavesEmpresa.rangos, ['stats'], ['avisos']]) void cliente.invalidateQueries({ queryKey })
    } catch (e) {
      setErrorServidor(e instanceof ApiError ? e.message : 'No se pudo registrar el rango. Inténtalo de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  let cuerpo: JSX.Element
  if (stats.isPending) {
    cuerpo = <Skeleton alto={96} filas={Math.max(1, tipos.length)} />
  } else if (stats.isError) {
    cuerpo = (
      <Banner tono="danger" accion={{ etiqueta: 'Reintentar', onClick: () => void stats.refetch() }}>
        {stats.error instanceof ApiError ? stats.error.message : 'No se pudo cargar la numeración.'}
      </Banner>
    )
  } else {
    cuerpo = (
      <>
        {admin && rangos.isError && (
          <Banner tono="warning" accion={{ etiqueta: 'Reintentar', onClick: () => void rangos.refetch() }}>
            No se pudieron cargar los rangos. El estado de cada tipo sí está al día.
          </Banner>
        )}
        <ul className="numeracion">
          {tarjetas.map((t) => (
            <li key={t.tipo} className="numeracion__tarjeta">
              <div className="numeracion__cabeza">
                <h2 className="numeracion__nombre">{t.nombre}</h2>
                <span className={`numeracion__estado numeracion__estado--${tonoNumeracion(t.estado)}`}>{t.resumen}</span>
              </div>
              {t.detalle !== null && <p className="numeracion__detalle">{t.detalle}</p>}
              {admin && t.rangos.length > 0 && (
                <ul className="numeracion__rangos">
                  {t.rangos.map((r) => (
                    <li key={r.id} className="numeracion__rango">
                      <strong>
                        Del {miles(r.desde)} al {r.hasta === null ? 'último (sin límite)' : miles(r.hasta)}
                      </strong>
                      <span>
                        {r.hasta === null ? 'Sin límite' : `Quedan ${miles(r.restantes ?? 0)}`} · usados {miles(r.usados)}
                        {r.vence !== null ? ` · vence el ${fmtFechaISO(r.vence)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {admin && (
                <Button variante="secundario" bloque onClick={() => abrir(t.tipo)}>
                  Registrar rango de E{t.tipo}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!admin && <p className="mas-pantalla__nota">Solo un administrador puede registrar rangos nuevos.</p>}
      </>
    )
  }

  return (
    <div className="pantalla">
      <Cabecera titulo="Numeración e-CF" atras="historial" />
      <div className="mas-pantalla" aria-busy={stats.isPending || undefined}>
        {cuerpo}
      </div>
      <BottomSheet
        abierto={abierta}
        onCerrar={() => setAbierta(false)}
        titulo="Registrar rango"
        pie={
          <div className="rango-form__pie">
            <Button bloque cargando={enviando} onClick={() => void guardar()}>
              Guardar rango
            </Button>
          </div>
        }
      >
        <div className="rango-form">
          {errorServidor !== null && <Banner tono="danger">{errorServidor}</Banner>}
          <p className="mas-pantalla__nota">Escribe el rango que la DGII te autorizó. Sin un rango vigente no se puede emitir.</p>
          {tipos.length > 1 && (
            <SegmentedControl
              etiquetaGrupo="Tipo de comprobante"
              opciones={tipos.map((t) => ({ valor: t, etiqueta: `E${t}` }))}
              valor={form.tipo}
              onCambio={(tipo) => cambiar({ tipo })}
            />
          )}
          {errores.tipo !== undefined && <Banner tono="danger">{errores.tipo}</Banner>}
          <NumericField etiqueta="Número inicial" valor={form.desde} onCambio={(desde) => cambiar({ desde })} error={errores.desde} enterkeyhint="next" />
          <NumericField etiqueta="Número final" valor={form.hasta} onCambio={(hasta) => cambiar({ hasta })} error={errores.hasta} enterkeyhint="next" />
          <DateField etiqueta="Vence el" valor={form.vence} onCambio={(vence) => cambiar({ vence })} min={hoyLocal} error={errores.vence} />
          <TextField
            etiqueta={ambiente === 'ecf' ? 'Número de autorización' : 'Número de autorización (opcional)'}
            valor={form.noAutorizacion}
            onCambio={(noAutorizacion) => cambiar({ noAutorizacion })}
            error={errores.noAutorizacion}
            enterkeyhint="next"
          />
          <TextField etiqueta="Número de solicitud (opcional)" valor={form.noSolicitud} onCambio={(noSolicitud) => cambiar({ noSolicitud })} enterkeyhint="done" onEnter={() => void guardar()} />
        </div>
      </BottomSheet>
    </div>
  )
}
