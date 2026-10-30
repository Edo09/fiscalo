// «Esta cuenta no está habilitada en Express» (anexo 6.14): la cuenta entró bien, pero su empresa usa la versión completa de Fiscalpoint, o el API no mandó el
// bloque de entitlements (entitlements.ts: sin él la cuenta falla cerrada y no es de Express). App la dibuja en lugar del shell (sin barra) cuando
// `leerEntitlements` da null o la guardia dice `edicion`. Dos salidas: ir a la app completa y cerrar sesión; la sesión no se revoca sola.
// A pantalla completa y con su propio <main>, como Login: App la devuelve sola, sin envolverla en el shell.
import { useState } from 'react'
import { APP_COMPLETA_URL } from '~/config'
import { cerrarSesionExpress } from '~/lib/sesion'
import { Button } from '~/ui/Button'
import './Edicion.css'

/** El dominio de la app completa tal como se escribe en el texto: sale de `APP_COMPLETA_URL`, para que el texto y el enlace no se separen. */
const DOMINIO_APP_COMPLETA = APP_COMPLETA_URL.replace(/^https?:\/\//, '').replace(/\/+$/, '')

export default function Edicion(): JSX.Element {
  const [saliendo, setSaliendo] = useState(false)

  const salir = async (): Promise<void> => {
    setSaliendo(true)
    try {
      await cerrarSesionExpress() // al terminar App ve que no hay sesión y dibuja el Login; esta pantalla se desmonta
    } finally {
      setSaliendo(false)
    }
  }

  return (
    <main className="edicion">
      <div className="edicion__contenido">
        <img className="edicion__logo" src="/icons/mark.svg" alt="" width={56} height={56} />
        <h1 className="edicion__titulo">Esta cuenta no está habilitada en Express</h1>
        <p className="edicion__texto">Tu empresa usa la versión completa de Fiscalpoint. Entra desde {DOMINIO_APP_COMPLETA}.</p>
        <div className="edicion__acciones">
          {/* Un enlace con la forma del botón primario: va a otra página (otro servidor), así que es un <a>, y Button solo hace <button>. Las clases son las de Button.css. */}
          <a className="boton boton--primario boton--bloque" href={APP_COMPLETA_URL} target="_blank" rel="noopener noreferrer">
            Ir a Fiscalpoint
          </a>
          <Button variante="secundario" bloque cargando={saliendo} onClick={() => void salir()}>
            Cerrar sesión
          </Button>
        </div>
      </div>
    </main>
  )
}
