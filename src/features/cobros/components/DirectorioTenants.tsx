// La pestaña "Clientes" de Cobros de tenants: el DIRECTORIO de las empresas que usan la plataforma, con el cobro mensual de
// cada una y lo que debe. Es lo que se ve al entrar: sin ella, quien cobra no veía a sus tenants hasta que tuvieran un cobro.
// La búsqueda por nombre o RNC la hace el servidor (con demora al teclear); los filtros rápidos y el tipo de empresa, aquí.
// Un clic en la fila abre el panel de la empresa (historial, cobro mensual); "Configurar" y "Nuevo cobro" van directo.
// No todos los tenants son clientes (varios se crearon solo para certificar, o son de prueba): "No es cliente" los quita de la
// lista sin borrar nada, y "Mostrar las que no son clientes" los vuelve a traer para devolverlos.
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Avatar, Btn, Card, Dropdown, EmptyState, ErrorState, Icon, LoadingState, MenuItem, Money } from '@/components/ui'
import { ApiError, type TenantBuscado } from '@/api'
import { cobrosTexto, detalleCobroMensual, diasTexto, fechaCorta, subtituloTenant } from '../format'
import { useDirectorioTenants, useExcluirTenant } from '../hooks'
import {
  FILTROS_DIRECTORIO, MAX_DIRECTORIO, TIPOS_DIRECTORIO, clientesDelDirectorio, conteoDeFiltro, contarExcluidos, filtrarDirectorio,
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
  const [conExcluidos, setConExcluidos] = useState(false)

  // La consulta real se actualiza tras BUSQUEDA_MS sin teclear.
  useEffect(() => {
    const t = setTimeout(() => setTexto(input.trim()), BUSQUEDA_MS)
    return () => clearTimeout(t)
  }, [input])

  const { data, error, loading, fetching, reload } = useDirectorioTenants(texto)
  const empresas = useMemo(() => data ?? [], [data])
  const excluidas = useMemo(() => contarExcluidos(empresas), [empresas])
  // Ver las que no son clientes solo cuenta como filtro activo mientras haya alguna (al devolver la última, el botón desaparece).
  const verExcluidas = conExcluidos && excluidas > 0
  // Los contadores y el pie cuentan lo que se ve: sin las que no son clientes, a menos que se pida verlas.
  const visibles = useMemo(() => clientesDelDirectorio(empresas, verExcluidas), [empresas, verExcluidas])
  const resumen = useMemo(() => resumenDirectorio(visibles), [visibles])
  const filas = useMemo(() => filtrarDirectorio(empresas, { filtro, tipo, conExcluidos: verExcluidas }), [empresas, filtro, tipo, verExcluidas])
  const resumenFilas = useMemo(() => resumenDirectorio(filas), [filas])
  const filtrado = input.trim() !== '' || filtro !== 'todos' || tipo !== 'todas' || verExcluidas
  const limpiar = () => { setInput(''); setTexto(''); setFiltro('todos'); setTipo('todas'); setConExcluidos(false) }

  const devolver = async (t: TenantBuscado) => {
    try {
      await excluir.mutateAsync({ clientId: t.id, excluido: false })
      toast.success(`${t.nombre} volvió a la lista de clientes.`)
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
        {excluidas > 0 && (
          <button
            type="button" className={'filter-chip' + (verExcluidas ? ' active' : '')} aria-pressed={verExcluidas}
            title='Las que quitaste de la lista con "No es cliente"' onClick={() => setConExcluidos((v) => !v)}
          >
            <Icon name={verExcluidas ? 'eye' : 'eye-off'} />Mostrar las que no son clientes <span className="muted-3">{excluidas}</span>
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
            title={filtrado ? 'Ninguna empresa coincide' : empresas.length > 0 ? 'Ninguna empresa es un cliente' : 'No hay empresas registradas'}
            action={filtrado
              ? <Btn variant="secondary" icon="x" onClick={limpiar}>Limpiar filtros</Btn>
              : empresas.length > 0 ? <Btn variant="secondary" icon="eye" onClick={() => setConExcluidos(true)}>Mostrar las que no son clientes</Btn> : undefined}
          >
            {filtrado
              ? 'Prueba con otro nombre, otro RNC u otros filtros.'
              : empresas.length > 0
                ? 'Todas las empresas están marcadas como "no es cliente". Puedes verlas y devolver las que sí lo son.'
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
                  <tr key={t.id} onClick={() => abrirPanel(t.id)} style={t.excluido ? { opacity: 0.62 } : undefined}>
                    <td>
                      <div className="row gap-sm">
                        <Avatar name={t.nombre} size={30} />
                        <div>
                          <span className="cell-main">{t.nombre}</span>
                          <div className="cell-sub">{subtituloTenant(t)}</div>
                          {t.excluido && (
                            <div className="cell-sub fw6" title={t.motivo_exclusion ?? undefined}>
                              No es cliente{t.motivo_exclusion ? ` · ${t.motivo_exclusion}` : ''}
                            </div>
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
                        {t.excluido ? (
                          <Btn variant="secondary" size="sm" icon="user-check" onClick={() => void devolver(t)} disabled={excluir.isPending}>
                            Volver a la lista
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
                          {t.excluido ? (
                            <MenuItem icon="user-check" onClick={() => void devolver(t)}>Volver a la lista de clientes</MenuItem>
                          ) : (
                            <>
                              <MenuItem icon="settings" onClick={() => abrirPanel(t.id, 'config')}>Cobro mensual</MenuItem>
                              <MenuItem icon="plus" onClick={() => abrirModal({ tipo: 'cobro', cobroId: null, clientId: t.id })}>Nuevo cobro</MenuItem>
                              <MenuItem icon="user-x" danger onClick={() => abrirModal({ tipo: 'excluir', clientId: t.id, nombre: t.nombre })}>
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
