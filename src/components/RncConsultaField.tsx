// FISCALO — Campo "RNC o cédula" con botón Consultar (GET /api/rnc/consulta).
//
// Lo usan el alta de clientes y la de proveedores: se escribe el RNC, se consulta
// y, si hay datos, el padre rellena su formulario con onEncontrado. El servicio
// detrás es de TERCEROS, así que fallar es un caso normal: se dice por qué y el
// usuario sigue llenando a mano. Nunca bloquea guardar.
import { useRef, useState } from 'react'
import { Badge, Btn, Icon } from '@/components/ui'
import { ApiError, consultarRnc } from '@/api'
import type { ConsultaRnc } from '@/api'

type Resultado =
  | { tipo: 'inicial' }
  | { tipo: 'consultando' }
  | { tipo: 'encontrado'; datos: ConsultaRnc; existente: string | null }
  | { tipo: 'no-encontrado' }
  | { tipo: 'formato' }
  | { tipo: 'no-disponible' }

interface RncConsultaFieldProps {
  value: string
  onChange: (rnc: string) => void
  /** Datos de la DGII: cada formulario decide qué campos rellena con ellos. */
  onEncontrado: (datos: ConsultaRnc) => void
  /**
   * Nombre de un registro propio que ya tiene este RNC, o null. Solo se avisa,
   * no se bloquea: puede haber varios contactos de una misma empresa.
   */
  buscarExistente?: (rnc: string) => Promise<string | null>
  avisoExistente?: string
  label?: string
  placeholder?: string
  autoFocus?: boolean
  /** false = muestra el asterisco de obligatorio. */
  opcional?: boolean
}

const soloDigitos = (v: string) => v.replace(/\D/g, '')

/** "DADO DE BAJA" -> "Dado de baja". */
const estadoLegible = (estado: string) =>
  estado ? estado.charAt(0) + estado.slice(1).toLowerCase() : 'Estado desconocido'

export function RncConsultaField({
  value,
  onChange,
  onEncontrado,
  buscarExistente,
  avisoExistente = 'Ya existe un registro con este RNC',
  label = 'RNC o cédula',
  placeholder = '131000000',
  autoFocus = false,
  opcional = true,
}: RncConsultaFieldProps) {
  const [resultado, setResultado] = useState<Resultado>({ tipo: 'inicial' })
  // Cada consulta y cada tecla suben el turno: si el usuario cambia el RNC
  // mientras la consulta viaja, la respuesta vieja se descarta en vez de
  // rellenar el formulario con otro contribuyente.
  const turno = useRef(0)

  const consultar = async () => {
    const rnc = soloDigitos(value)
    if (rnc.length !== 9 && rnc.length !== 11) {
      setResultado({ tipo: 'formato' })
      return
    }
    const miTurno = ++turno.current
    setResultado({ tipo: 'consultando' })
    // El duplicado se busca en paralelo; si esa búsqueda falla, no pasa nada.
    const existente = buscarExistente ? buscarExistente(rnc).catch(() => null) : Promise.resolve(null)
    try {
      const datos = await consultarRnc(rnc)
      if (miTurno !== turno.current) return
      onChange(datos.rnc)
      onEncontrado(datos)
      const yaExiste = await existente
      if (miTurno !== turno.current) return
      setResultado({ tipo: 'encontrado', datos, existente: yaExiste })
    } catch (e) {
      if (miTurno !== turno.current) return
      const status = e instanceof ApiError ? e.status : 0
      // Un 404 solo es "no inscrito" si lo dijo nuestro endpoint, que trae su
      // propio mensaje. Un 404 sin cuerpo JSON (backend aún sin desplegar, proxy
      // mal configurado) llega con el mensaje genérico del cliente HTTP, y eso es
      // "no disponible": decir "no inscrito" mandaría a revisar un RNC correcto.
      const generico = e instanceof ApiError && /^(Respuesta no válida|Error HTTP)/.test(e.message)
      setResultado(
        status === 404 && !generico
          ? { tipo: 'no-encontrado' }
          : status === 422 && !generico
            ? { tipo: 'formato' }
            : { tipo: 'no-disponible' },
      )
    }
  }

  const consultando = resultado.tipo === 'consultando'

  return (
    <div className="field full">
      <label>
        {label} {opcional ? <span className="opt">(opcional)</span> : <span className="req">*</span>}
      </label>
      <div className="row gap-sm" style={{ alignItems: 'stretch' }}>
        <input
          className="input mono"
          style={{ flex: 1, minWidth: 0 }}
          value={value}
          onChange={(e) => {
            turno.current++
            onChange(e.target.value)
            if (resultado.tipo !== 'inicial') setResultado({ tipo: 'inicial' })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void consultar() }
          }}
          placeholder={placeholder}
          inputMode="numeric"
          autoFocus={autoFocus}
          aria-label={label}
        />
        <Btn variant="secondary" icon="search" onClick={() => void consultar()} disabled={consultando}>
          {consultando ? 'Consultando…' : 'Consultar'}
        </Btn>
      </div>

      {resultado.tipo === 'inicial' && (
        <div className="text-xs muted-3" style={{ marginTop: 5 }}>
          Consulta el RNC para llenar los datos de la DGII automáticamente.
        </div>
      )}

      {resultado.tipo === 'encontrado' && (
        <div style={{ marginTop: 6 }}>
          <div className="row gap-sm text-sm" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Icon name="check-circle" size={15} style={{ color: 'var(--success)' }} />
            <span className="fw6">{resultado.datos.razon_social}</span>
            <Badge tone={resultado.datos.estado === 'ACTIVO' ? 'success' : 'danger'}>
              {estadoLegible(resultado.datos.estado)}
            </Badge>
            {resultado.datos.facturador_electronico && <Badge tone="info">Facturador electrónico</Badge>}
          </div>
          <div className="text-xs muted-3" style={{ marginTop: 3 }}>
            Datos de la DGII: confirma que es el contribuyente correcto antes de guardar.
          </div>
          {resultado.existente && (
            <div className="row gap-sm text-xs" style={{ marginTop: 4, alignItems: 'center', color: 'var(--warning)' }}>
              <Icon name="alert-triangle" size={13} />
              <span>{avisoExistente}: {resultado.existente}</span>
            </div>
          )}
        </div>
      )}

      {resultado.tipo === 'no-encontrado' && (
        <div className="err-msg">
          <Icon name="alert-circle" size={13} />
          No está inscrito como contribuyente en la DGII. Revisa el número o completa los datos a mano.
        </div>
      )}

      {resultado.tipo === 'formato' && (
        <div className="err-msg">
          <Icon name="alert-circle" size={13} />
          El RNC lleva 9 dígitos y la cédula 11.
        </div>
      )}

      {resultado.tipo === 'no-disponible' && (
        <div className="row gap-sm text-xs" style={{ marginTop: 5, alignItems: 'center', color: 'var(--warning)' }}>
          <Icon name="alert-triangle" size={13} />
          <span>La consulta no está disponible ahora. Completa los datos a mano.</span>
        </div>
      )}
    </div>
  )
}
