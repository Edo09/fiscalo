// La pantalla de entrada (anexo 6.1): la marca de FiscalPoint (el logo, el nombre y, desde 900 px de ancho, el mensaje de marca) y la hoja con «Correo o
// usuario», «Contraseña» (con «Mostrar» y «Ocultar») y un «Entrar» de 52 px. No hay campo de empresa: el servidor la deduce de la cuenta. Las reglas están
// en loginReglas.ts (el texto del error, dónde se puede entrar); aquí solo se arma la pantalla. El texto de marca es el de la app completa (LoginView.tsx),
// salvo la tercera ventaja: Express no tiene reportes de ITBIS, y no se promete lo que no hace.
//
// Qué pasa al enviar:
//  - Sin red el botón está deshabilitado y dice por qué (con `disabled` el Intro de los campos tampoco envía).
//  - En una vista previa de Vercel (`*.vercel.app`, cuyo proxy apunta a producción) se rechaza, con la bandera de desarrollo como única salida.
//  - Mientras espera, los campos quedan bloqueados y el botón gira; un error se muestra en línea y deja escribir de nuevo.
//  - Si entra, solo se llama a `guardarSesion`: App ve el token y cambia de pantalla (a la de edición si la cuenta no es de Express), y el hash queda como
//    destino de regreso. No se toca el estado después: esta pantalla se desmonta, y hasta entonces el botón se queda girando.
// Se dibuja a pantalla completa y con su propio <main>: App la devuelve sola, sin envolverla en el shell.
import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { login } from '@/api/auth'
import { ApiError } from '@/api/errores'
import { CLAVE_PREVIEW } from '~/config'
import { leerTexto } from '~/lib/almacen'
import { guardarSesion } from '~/lib/sesion'
import { useEnLinea } from '~/net/enLinea'
import { Banner } from '~/ui/Banner'
import { Button } from '~/ui/Button'
import { Icon } from '~/ui/Icon'
import type { IconName } from '~/ui/Icon'
import { TextField } from '~/ui/TextField'
import { loginPermitido, mensajeLogin } from './loginReglas'
import './Login.css'

/** Por qué «Entrar» está deshabilitado sin red. */
const MSG_SIN_CONEXION = 'Sin conexión: conéctate para entrar'
/** Lo que se dice al intentar entrar desde una vista previa de Vercel. */
const MSG_VISTA_PREVIA = 'Esta vista previa es solo para revisar el diseño: no se puede iniciar sesión aquí.'

/** Las tres ventajas del panel de marca (solo se ve en pantallas anchas). */
const VENTAJAS: ReadonlyArray<readonly [IconName, string]> = [
  ['file-text', 'Emisión de e-CF en segundos'],
  ['circle-check', 'Validación automática con la DGII'],
  ['users', 'Tus clientes y productos a la mano'],
]

export default function Login(): JSX.Element {
  const enLinea = useEnLinea()
  const idClave = useId()
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [verClave, setVerClave] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const entrar = async (): Promise<void> => {
    if (enviando || !enLinea) return
    if (!loginPermitido(location.hostname, leerTexto(CLAVE_PREVIEW))) {
      setError(MSG_VISTA_PREVIA)
      return
    }
    setError(null) // también con el mismo error de antes: el aviso se vuelve a dibujar y a anunciar
    setEnviando(true)
    try {
      // El correo se recorta (los teclados del teléfono dejan un espacio al final al aceptar una sugerencia); la contraseña va tal cual.
      const res = await login(usuario.trim(), clave)
      // Un «éxito» sin sesión no se guarda a medias: el store quedaría con un token que no existe.
      if (typeof res?.token !== 'string' || res.token === '' || !res.user) throw new Error('El login respondió sin token o sin usuario')
      guardarSesion(res.token, res.user)
    } catch (e) {
      if (!(e instanceof ApiError)) console.error('[login]', e) // el texto de un error de JavaScript no se le enseña a nadie, pero queda en la consola
      setError(mensajeLogin(e))
      setEnviando(false)
    }
  }

  const alEnviar = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    void entrar()
  }

  return (
    <div className="login">
      {/* La marca: una franja arriba en el teléfono y el panel de la izquierda en pantallas anchas (es el mismo elemento). */}
      <header className="login__marca">
        <div className="login__firma">
          <img className="login__logo" src="/icons/mark.svg" alt="" width={52} height={52} />
          <span className="login__nombre">
            FiscalPoint
            <span className="login__punto" aria-hidden="true">
              .
            </span>
          </span>
          <span className="login__edicion">Express</span>
        </div>

        <div className="login__mensaje">
          <p className="login__titular">Tu facturación fiscal, en orden y al día.</p>
          <p className="login__texto">Emite, firma y transmite tus comprobantes electrónicos a la DGII desde donde estés.</p>
          <ul className="login__ventajas">
            {VENTAJAS.map(([icono, texto]) => (
              <li key={texto}>
                <Icon name={icono} size={20} />
                {texto}
              </li>
            ))}
          </ul>
        </div>
      </header>

      {/* La hoja: el papel del logo (con la esquina doblada) sobre la franja. */}
      <main className="login__hoja">
        <div className="login__columna">
          <h1 className="login__titulo">Bienvenido de nuevo</h1>

          <form className="login__formulario" onSubmit={alEnviar} noValidate>
            <TextField
              etiqueta="Correo o usuario"
              valor={usuario}
              onCambio={(v) => {
                setUsuario(v)
                setError(null)
              }}
              tipo="email"
              autoComplete="username"
              autoCapitalize="none"
              enterkeyhint="next"
              onEnter={() => document.getElementById(idClave)?.focus()}
              disabled={enviando}
            />

            <div className="login__clave">
              <div className="login__clave-campo">
                <TextField
                  id={idClave}
                  etiqueta="Contraseña"
                  valor={clave}
                  onCambio={(v) => {
                    setClave(v)
                    setError(null)
                  }}
                  tipo={verClave ? 'text' : 'password'}
                  autoComplete="current-password"
                  autoCapitalize="none"
                  enterkeyhint="go"
                  disabled={enviando}
                />
              </div>
              {/* El botón de mostrar no le quita el foco al campo (con `mousedown` sin efecto): en el teléfono el teclado sigue abierto mientras se revisa lo escrito. */}
              <Button
                variante="texto"
                className="login__ver"
                aria-controls={idClave}
                aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setVerClave(!verClave)}
              >
                {verClave ? 'Ocultar' : 'Mostrar'}
              </Button>
            </div>

            {error !== null && <Banner tono="danger">{error}</Banner>}

            {/* Un contenedor de bloque: la razón del botón sale como hermana suya, debajo (Button.tsx). */}
            <div className="login__acciones">
              <Button type="submit" bloque cargando={enviando} disabled={!enLinea} razon={MSG_SIN_CONEXION}>
                Entrar
              </Button>
            </div>
          </form>

          <p className="login__pie">Facturación Electrónica · DGII · República Dominicana</p>
        </div>
      </main>
    </div>
  )
}
