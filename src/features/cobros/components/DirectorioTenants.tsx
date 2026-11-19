// La pestaña "Clientes" de Cobros de tenants: el DIRECTORIO de las empresas que usan la plataforma, con el cobro mensual de
// cada una y lo que debe. Es lo que se ve al entrar: sin ella, quien cobra no veía a sus tenants hasta que tuvieran un cobro.
// La búsqueda por nombre o RNC la hace el servidor (con demora al teclear); los filtros rápidos y el tipo de empresa, aquí.
// Un clic en la fila abre el panel de la empresa (historial, cobro mensual); "Configurar" y "Nuevo cobro" van directo.
// Solo salen las empresas a las que se les cobra: las de base propia, las de integración en producción y las que tienen su cobro
// mensual activo. Un grupo de empresas (mismo cliente) es UNA fila, la de su cabeza, que lleva el cobro de todo el grupo. Las que
// no se cobran (marcadas "No es cliente", o que solo certificaron) se ven con "Mostrar las que no se cobran", cada una con su razón:
// a la primera se le devuelve a la lista, a la segunda se le activa su cobro mensual.
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Avatar, Btn, Card, Dropdown, EmptyState, ErrorState, Icon, LoadingState, MenuItem, Money } from '@/components/ui'
import { ApiError, type TenantBuscado } from '@/api'
import { cobrosTexto, detalleCobroMensual, diasTexto, etiquetaOculta, fechaCorta, lineasGrupo, subtituloTenant, textoGrupo } from '../format'
import { useDirectorioTenants, useExcluirTenant } from '../hooks'
import {
  FILTROS_DIRECTORIO, MAX_DIRECTORIO, TIPOS_DIRECTORIO, clientesDelDirectorio, conteoDeFiltro, contarOcultas, filtrarDirectorio,
  resumenDirectorio, type FiltroDirectorio, type TipoDirectorio,
} from '../directorio'
import { useCobrosUi } from '../store'
import { Aviso } from './Aviso'

const BUSQUEDA_MS = 300

export function DirectorioTenants() {
  const abrirPanel = useCobrosUi((s) => s.abrirPanel)
  const abrirModal = useCobrosUi((s) => s.abrirModal)
  const excluir = useExcluirTenant()
  const [input, setInput] = useState('')
  const [texto, setTexto] = useState('')
  const [filtro, setFiltro] = useState<FiltroDirectorio>('todos')
  const [tipo, setTipo] = useState<TipoDirectorio>('todas')
  const [conOcultas, setConOcultas] = useState(false)
  // Los grupos con su lista de empresas a la vista (un botón por grupo: sirve con teclado y en pantallas táctiles).
  const [gruposAbiertos, setGruposAbiertos] = useState<ReadonlySet<number>>(new Set())
  const alternarGrupo = (id: number) => setGruposAbiertos((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  // La consulta real se actualiza tras BUSQUEDA_MS sin teclear.
  useEffect(() => {
    const t = setTimeout(() => setTexto(input.trim()), BUSQUEDA_MS)
    return () => clearTimeout(t)
  }, [input])

  const { data, error, loading, fetching, reload } = useDirectorioTenants(texto)
  const empresas = useMemo(() => data ?? [], [data])
  const ocultas = useMemo(() => contarOcultas(empresas), [empresas])
  // Ver las que no se cobran solo cuenta como filtro activo mientras haya alguna (al devolver la última, el botón desaparece).
  const verOcultas = conOcultas && ocultas > 0
  // Los contadores y el pie cuentan lo que se ve: sin las que no se cobran, a menos que se pida verlas.
  const visibles = useMemo(() => clientesDelDirectorio(empresas, verOcultas), [empresas, verOcultas])
  const resumen = useMemo(() => resumenDirectorio(visibles), [visibles])
  const filas = useMemo(() => filtrarDirectorio(empresas, { filtro, tipo, conOcultas: verOcultas }), [empresas, filtro, tipo, verOcultas])
  const resumenFilas = useMemo(() => resumenDirectorio(filas), [filas])
  const filtrado = input.trim() !== '' || filtro !== 'todos' || tipo !== 'todas' || verOcultas
  const limpiar = () => { setInput(''); setTexto(''); setFiltro('todos'); setTipo('todas'); setConOcultas(false) }

  const devolver = async (t: TenantBuscado) => {
    try {
      await excluir.mutateAsync({ clientId: t.id, excluido: false })
      // Solo se sabe que se quitó la marca: si además solo certificó y no tiene cobro mensual activo, sigue oculta con su razón.
      toast.success(`Se quitó la marca "No es cliente" de ${t.nombre}.`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo devolver la empresa a la lista de clientes.')
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="search-input">
          <Icon name={fetching && !loading ? 'loader' : 'search'} className={fetching && !loading ? 'spin' : undefined} />
          <input
            placeholder="Buscar empresa por nombre o RNC…" value={input} onChange={(e) => setInput(e.target.value)}
            aria-label="Buscar empresas por nombre o RNC"
          />
        </div>
        {FILTROS_DIRECTORIO.map((f) => (
          <button
            key={f.id} type="button" className={'filter-chip' + (filtro === f.id ? ' active' : '')}
            onClick={() => setFiltro(f.id)}
          >
            {f.label} <span className="muted-3">{conteoDeFiltro(resumen, f.id)}</span>
          </button>
        ))}
      </div>

      <div className="toolbar" style={{ marginTop: -6 }}>
        <span className="text-sm muted">Empresas:</span>
        {TIPOS_DIRECTORIO.map((t) => (
          <button
            key={t.id} type="button" className={'filter-chip' + (tipo === t.id ? ' active' : '')}
            onClick={() => setTipo(t.id)}
          >
            {t.label}
          </button>
        ))}
        {ocultas > 0 && (
          <button
            type="button" className={'filter-chip' + (verOcultas ? ' active' : '')} aria-pressed={verOcultas}
            title='Las que no se cobran: las marcadas "No es cliente" y las que solo certificaron (sin cobro mensual activo)'
            onClick={() => setConOcultas((v) => !v)}
          >
            <Icon name={verOcultas ? 'eye' : 'eye-off'} />Mostrar las que no se cobran <span className="muted-3">{ocultas}</span>
          </button>
        )}
        {filtrado && <button type="button" className="filter-chip" onClick={limpiar}><Icon name="x" />Limpiar filtros</button>}
      </div>

      {empresas.length >= MAX_DIRECTORIO && (
        <Aviso>Se muestran las primeras {MAX_DIRECTORIO} empresas. Para ver las demás, afina la búsqueda por nombre o RNC.</Aviso>
      )}

      <Card noPad>
        {loading ? (
          <LoadingState rows={7} />
        ) : error && data === null ? (
          <ErrorState title="No se pudieron cargar las empresas" onRetry={reload}>{error}</ErrorState>
        ) : filas.length === 0 ? (
          <EmptyState
            icon="users"
            title={filtrado ? 'Ninguna empresa coincide' : empresas.length > 0 ? 'Ninguna empresa se cobra' : 'No hay empresas registradas'}
            action={filtrado
              ? <Btn variant="secondary" icon="x" onClick={limpiar}>Limpiar filtros</Btn>
              : empresas.length > 0 ? <Btn variant="secondary" icon="eye" onClick={() => setConOcultas(true)}>Mostrar las que no se cobran</Btn> : undefined}
          >
            {filtrado
              ? 'Prueba con otro nombre, otro RNC u otros filtros.'
              : empresas.length > 0
                ? 'Ninguna empresa se cobra todavía: están marcadas "no es cliente" o solo certificaron. Puedes verlas, devolver las que sí lo son o activarles su cobro mensual.'
                : 'Las empresas que se registren en la plataforma aparecen aquí.'}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Empresa</th><th>Cobro mensual</th><th className="num">Pendiente</th><th className="num">Vencido</th>
                  <th>Próximo vencimiento</th><th style={{ width: 190 }}></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((t) => (
                  <tr key={t.id} onClick={() => abrirPanel(t.id)} style={t.facturable ? undefined : { opacity: 0.62 }}>
                    <td>
                      <div className="row gap-sm">
                        <Avatar name={t.nombre} size={30} />
                        <div>
                          <span className="cell-main">{t.nombre}</span>
                          <div className="cell-sub">{subtituloTenant(t)}</div>
                          {t.grupo && (
                            <>
                              <button
                                type="button" className="cell-sub" aria-expanded={gruposAbiertos.has(t.id)}
                                aria-label={`${textoGrupo(t)} de ${t.nombre}: ${gruposAbiertos.has(t.id) ? 'ocultar' : 'ver'} las empresas`}
                                style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
                                onClick={(e) => { e.stopPropagation(); alternarGrupo(t.id) }}
                              >
                                {textoGrupo(t)}{' '}
                                <span style={{ display: 'inline-block', transform: gruposAbiertos.has(t.id) ? 'rotate(180deg)' : undefined }}>
                                  <Icon name="chevron-down" size={12} />
                                </span>
                              </button>
                              {gruposAbiertos.has(t.id) && (
                                <ul className="cell-sub" style={{ margin: '2px 0 0', paddingLeft: 16 }}>
                                  {lineasGrupo(t).map((l) => <li key={l}>{l}</li>)}
                                </ul>
                              )}
                            </>
                          )}
                          {!t.facturable && (
                            <div className="cell-sub fw6" title={t.motivo_exclusion ?? undefined}>{etiquetaOculta(t)}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      {t.config ? (
                        <>
                          <span className="fw6"><Money value={t.config.monto_mensual} /></span>
                          <div className="cell-sub">{detalleCobroMensual(t.config)}</div>
                        </>
                      ) : (
                        <span className="muted-3">Sin configurar</span>
                      )}
                    </td>
                    <td className="num">
                      {t.saldo_pendiente > 0 ? (
                        <>
                          <span className="fw6"><Money value={t.saldo_pendiente} cur={false} /></span>
                          <div className="cell-sub">{cobrosTexto(t.cobros_abiertos)}</div>
                        </>
                      ) : (
                        <span className="muted-3">—</span>
                      )}
                    </td>
                    <td className="num">
                      {t.saldo_vencido > 0 ? (
                        <span style={{ color: 'var(--danger)' }}>
                          <span className="fw6"><Money value={t.saldo_vencido} cur={false} /></span>
                          <div className="cell-sub" style={{ color: 'var(--danger)' }}>hace {diasTexto(t.dias_atraso)}</div>
                        </span>
                      ) : (
                        <span className="muted-3">—</span>
                      )}
                    </td>
                    <td>{t.proximo_vencimiento ? <span className="text-sm">{fechaCorta(t.proximo_vencimiento)}</span> : <span className="muted-3">—</span>}</td>
                    <td>
                      <span className="row gap-sm" style={{ justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                        {t.motivo_oculto === 'excluido' ? (
                          <Btn variant="secondary" size="sm" icon="user-check" onClick={() => void devolver(t)} disabled={excluir.isPending}>
                            Volver a la lista
                          </Btn>
                        ) : t.motivo_oculto === 'solo_certificacion' ? (
                          <Btn
                            variant="secondary" size="sm" icon="settings" onClick={() => abrirPanel(t.id, 'config')}
                            title="Al activarle un cobro mensual, la empresa pasa a cobrarse"
                          >
                            Cobro mensual
                          </Btn>
                        ) : t.config ? (
                          <Btn variant="secondary" size="sm" icon="plus" onClick={() => abrirModal({ tipo: 'cobro', cobroId: null, clientId: t.id })}>
                            Nuevo cobro
                          </Btn>
                        ) : (
                          <Btn variant="secondary" size="sm" icon="settings" onClick={() => abrirPanel(t.id, 'config')}>Configurar</Btn>
                        )}
                        <Dropdown
                          align="right" width={250}
                          trigger={<Btn variant="ghost" size="sm" icon="more-horizontal" aria-label={`Más acciones de ${t.nombre}`} />}
                        >
                          <MenuItem icon="user" onClick={() => abrirPanel(t.id)}>Ver historial de cobros</MenuItem>
                          {t.motivo_oculto === 'excluido' ? (
                            <MenuItem icon="user-check" onClick={() => void devolver(t)}>Volver a la lista de clientes</MenuItem>
                          ) : t.motivo_oculto === 'solo_certificacion' ? (
                            <MenuItem icon="settings" onClick={() => abrirPanel(t.id, 'config')}>Cobro mensual (la empresa pasa a cobrarse)</MenuItem>
                          ) : (
                            <>
                              <MenuItem icon="settings" onClick={() => abrirPanel(t.id, 'config')}>Cobro mensual</MenuItem>
                              <MenuItem icon="plus" onClick={() => abrirModal({ tipo: 'cobro', cobroId: null, clientId: t.id })}>Nuevo cobro</MenuItem>
                              <MenuItem
                                icon="user-x" danger
                                onClick={() => abrirModal({ tipo: 'excluir', clientId: t.id, nombre: t.nombre, empresas: t.grupo ? t.grupo.miembros.length + 1 : 1 })}
                              >
                                No es cliente (quitar de la lista)
                              </MenuItem>
                            </>
                          )}
                        </Dropdown>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--surface-2)' }}>
                  <td colSpan={2} className="fw6 text-sm" style={{ padding: '11px 14px' }}>
                    {filas.length === 1 ? '1 empresa' : `${filas.length} empresas`}
                  </td>
                  <td className="num fw6" style={{ padding: '11px 14px' }}><Money value={resumenFilas.saldoPendiente} cur={false} /></td>
                  <td className="num fw6" style={{ padding: '11px 14px', color: resumenFilas.saldoVencido > 0 ? 'var(--danger)' : undefined }}>
                    <Money value={resumenFilas.saldoVencido} cur={false} />
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
