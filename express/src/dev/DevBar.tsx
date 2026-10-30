// La barra de desarrollo: dos palancas para probar a mano lo que depende del día y del ambiente, sin tocar el API ni el reloj del aparato. SOLO DEV: `App` la baja con
// un `import()` detrás de `import.meta.env.DEV`, y el build de producción ni la trae ni su CSS (tarea 22, paso 3, lo comprueba en `dist`).
//  - Reloj simulado: `setRelojSimulado` (lib/reloj.ts) hace que `hoy()` y `ahora()` marquen otra fecha y hora, y sigan corriendo desde ahí. Solo lo honra ese módulo.
//    Los textos «hoy» y «ayer», el tile Hoy y los vencimientos lo leen al dibujarse: tras cambiarlo, lo que ya está en pantalla se actualiza en su próximo dibujo.
//  - Ambiente: cambia `entitlements.tenant.ambiente` del usuario que está en memoria (pruebas, certificación o producción), para ver la etiqueta de Más y los avisos de
//    cada ambiente. Pasa por `guardarSesion`, así que también lo guarda el store de sesión de este origen hasta el próximo `me()`, que trae el valor del servidor.
// El interruptor del estado del certificado llega con el plan 09.
import { useId, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useSession } from '@/stores/auth'
import { leerEntitlements } from '~/entitlements'
import type { Ambiente, UsuarioExpress } from '~/entitlements'
import { etiquetaAmbiente } from '~/lib/etiquetas'
import { setRelojSimulado } from '~/lib/reloj'
import { guardarSesion } from '~/lib/sesion'
import { Button } from '~/ui/Button'
import './DevBar.css'

const AMBIENTES: readonly Ambiente[] = ['testecf', 'certecf', 'ecf']

export default function DevBar(): JSX.Element {
  const sesion = useSession()
  const { token } = sesion
  const user: UsuarioExpress | null = sesion.user // el store guarda el usuario tal como llegó, con el bloque de entitlements que su tipo no declara
  const idReloj = useId()
  const idAmbiente = useId()
  /** Lo escrito en el campo de fecha y hora (`AAAA-MM-DDTHH:MM`, hora local); vacío es el reloj real. */
  const [reloj, setReloj] = useState('')
  const ambiente = leerEntitlements(user)?.tenant.ambiente ?? null

  const cambiarReloj = (e: ChangeEvent<HTMLInputElement>): void => {
    setReloj(e.target.value)
    setRelojSimulado(e.target.value === '' ? null : e.target.value) // un texto que no es una fecha también deja el reloj real
  }

  const relojReal = (): void => {
    setReloj('')
    setRelojSimulado(null)
  }

  const cambiarAmbiente = (e: ChangeEvent<HTMLSelectElement>): void => {
    const nuevo = AMBIENTES.find((a) => a === e.target.value)
    const bloque: unknown = user?.entitlements
    if (nuevo === undefined || token === null || user === null || typeof bloque !== 'object' || bloque === null) return
    const tenant: unknown = (bloque as { tenant?: unknown }).tenant
    if (typeof tenant !== 'object' || tenant === null) return
    // Se parchea una copia del bloque tal como llegó (con lo que `leerEntitlements` no lee también): el original no se muta.
    guardarSesion(token, { ...user, entitlements: { ...bloque, tenant: { ...tenant, ambiente: nuevo } } })
  }

  return (
    <details className="devbar">
      <summary className="devbar__resumen">DEV</summary>
      <div className="devbar__cuerpo">
        <div className="devbar__campo">
          <label htmlFor={idReloj}>Reloj simulado</label>
          <div className="devbar__fila">
            <input id={idReloj} className="devbar__entrada" type="datetime-local" value={reloj} onChange={cambiarReloj} />
            <Button variante="secundario" onClick={relojReal}>
              Real
            </Button>
          </div>
        </div>
        <div className="devbar__campo">
          <label htmlFor={idAmbiente}>Ambiente</label>
          <select id={idAmbiente} className="devbar__entrada" value={ambiente ?? ''} disabled={ambiente === null} onChange={cambiarAmbiente}>
            {ambiente === null && <option value="">Sin sesión de Express</option>}
            {AMBIENTES.map((a) => (
              <option key={a} value={a}>
                {etiquetaAmbiente(a).texto}
              </option>
            ))}
          </select>
        </div>
      </div>
    </details>
  )
}
