import { useEffect, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Icon, Spinner } from '@/components/ui'
import { ApiError, createClient, listClients, mapClientRow } from '@/api'
import { hasModule } from '@/config/permissions'
import { useSession } from '@/stores/auth'
import type { Cliente } from '@/types/domain'

/** Espera tras la última tecla para dar el nombre por terminado. */
const PAUSA_MS = 700
/** Límite del backend para el nombre y la empresa del cliente. */
const MAX_NOMBRE = 100

/**
 * Primera letra de cada palabra en mayúscula. El resto queda como se escribió:
 * "EIRL", "SRL" o un nombre tecleado todo en mayúsculas no se tocan. Solo
 * cambia letras que siguen siendo una sola al pasarlas a mayúscula, así el
 * texto conserva el largo y el cursor no salta.
 */
function capitalizarPalabras(texto: string): string {
  return texto.replace(/(^|[\s-])(\p{Ll})/gu, (_, antes: string, letra: string) => {
    const mayuscula = letra.toLocaleUpperCase('es')
    return antes + (mayuscula.length === 1 ? mayuscula : letra)
  })
}

/** Para comparar nombres sin que cuenten mayúsculas, tildes ni espacios de más. */
function normalizar(nombre: string): string {
  return nombre.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Nombre del cliente escrito a mano, para quien no está en el buscador.
 *
 * Se estaban haciendo facturas a clientes que nunca quedaban registrados: el
 * nombre vivía solo en esa factura. Al terminar de escribirlo aparece "Guardar"
 * dentro del campo, que lo da de alta como cliente (con solo el nombre; el
 * resto se completa luego en Clientes) y lo deja elegido en la factura. Si ya
 * había un cliente con ese mismo nombre, se elige ese en vez de duplicarlo.
 */
export function NombreClienteLibre({
  value, onChange, onGuardado, className = '',
}: {
  value: string
  onChange: (nombre: string) => void
  /** El nombre ya es un cliente: el recién creado o el que existía con ese nombre. */
  onGuardado: (cliente: Cliente) => void
  /** Clases extra del campo (p. ej. la marca de "cambiado"). */
  className?: string
}) {
  const queryClient = useQueryClient()
  const { user } = useSession()
  // Sin el módulo de clientes el alta la rechazaría el backend.
  const puedeGuardar = !user?.permissions || hasModule(user.permissions, 'clients')
  const [pausado, setPausado] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const nombre = value.trim()

  // "Terminó de escribir": pasó PAUSA_MS desde la última tecla.
  useEffect(() => {
    setPausado(false)
    if (nombre.length < 2) return
    const t = setTimeout(() => setPausado(true), PAUSA_MS)
    return () => clearTimeout(t)
  }, [nombre])

  const escribir = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.target
    // A mitad de una composición (teclados con acentos por IME) no se toca.
    const v = (e.nativeEvent as InputEvent).isComposing ? el.value : capitalizarPalabras(el.value)
    if (v !== el.value) {
      // Se corrige en el propio campo y el cursor se deja donde estaba: si lo
      // corrigiera React al re-renderizar, lo mandaría al final.
      const { selectionStart, selectionEnd } = el
      el.value = v
      el.setSelectionRange(selectionStart, selectionEnd)
    }
    onChange(v)
  }

  const guardar = async () => {
    if (guardando || nombre.length < 2) return
    setGuardando(true)
    try {
      const existentes = await listClients({ query: nombre, pageSize: 10 })
      const igual = existentes.items.find((r) =>
        [r.client_name, r.company_name, r.razon_social].some((n) => n && normalizar(n) === normalizar(nombre)))
      if (igual) {
        toast.info(`${nombre} ya estaba en tus clientes: se eligió ese.`)
        onGuardado(mapClientRow(igual))
        return
      }
      // El backend pide nombre y empresa; de un cliente de mostrador solo se sabe el nombre.
      const row = await createClient({ client_name: nombre, company_name: nombre })
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      toast.success(`${nombre} quedó guardado como cliente.`)
      onGuardado(mapClientRow(row))
    } catch (e) {
      toast.error('No se pudo guardar el cliente.', e instanceof ApiError ? { description: e.message } : undefined)
    } finally {
      setGuardando(false)
    }
  }

  const conAccion = puedeGuardar && nombre.length >= 2 && (pausado || guardando)

  return (
    <div className={'fx-libre' + (conAccion ? ' fx-libre--accion' : '')}>
      <input
        className={'fx-field fx-field-visible' + className}
        placeholder="o escribe un nombre…"
        value={value}
        maxLength={MAX_NOMBRE}
        onChange={escribir}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && conAccion) { e.preventDefault(); void guardar() }
        }}
        aria-label="Nombre del cliente si no está registrado"
      />
      {conAccion && (
        <button
          type="button"
          className="fx-libre-guardar"
          onClick={() => void guardar()}
          disabled={guardando}
          aria-label={guardando ? `Guardando ${nombre} como cliente` : `Guardar ${nombre} como cliente`}
          title="Guardarlo como cliente para las próximas facturas"
        >
          {guardando ? <Spinner /> : <Icon name="save" size={14} />}
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      )}
    </div>
  )
}
