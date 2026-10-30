// La hoja «Tu sesión venció» (anexo 6.14): el servidor dejó de reconocer el token (un 401 que se repite, o un token que murió de verdad: lib/sesion.ts) y la app
// no echa al usuario a Login: la hoja se abre SOBRE la pantalla en que estaba, con lo que tenía a medias (el borrador, la factura en vuelo) intacto, y pide entrar
// otra vez. App la dibuja mientras `useSesionExpirada()` sea verdadero.
//
// No se puede cerrar: el atrás, Esc, el asa y el fondo no hacen nada (`onCerrar` vacío: la hoja vuelve a empujar su entrada del historial, ui/capas.ts), porque sin
// sesión no hay nada que hacer detrás. Se sale entrando:
//  - el mismo usuario: el token vuelve al store y App deja de dibujar la hoja sola; la pantalla sigue como estaba y lo que quedó pendiente se retoma;
//  - otro usuario u otra empresa: `escucharSesion` avisa `usuarioCambio`; App vacía la caché (queryClient.ts) y lleva a Facturas (loginReglas.ts `rutaTrasEvento`).
// Aquí solo se llama a `guardarSesion` y no se toca el estado después: la hoja se desmonta, y hasta entonces el botón se queda girando (como en Login).
//
// El botón vive en el pie de la hoja (siempre a la vista, sobre el teclado) y envía el formulario del cuerpo con el atributo `form`: así Intro en la contraseña
// también envía. Los textos de «sin conexión» y de la vista previa son los de Login.tsx.
import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { login } from '@/api/auth'
import { ApiError } from '@/api/errores'
import { CLAVE_PREVIEW } from '~/config'
import { leerTexto } from '~/lib/almacen'
import { guardarSesion } from '~/lib/sesion'
import { useEnLinea } from '~/net/enLinea'
import { Banner } from '~/ui/Banner'
import { BottomSheet } from '~/ui/BottomSheet'
import { Button } from '~/ui/Button'
import { TextField } from '~/ui/TextField'
import { loginPermitido, mensajeLogin } from './loginReglas'
import './SesionSheet.css'

/** Por qué «Entrar y continuar» está deshabilitado sin red (el mismo texto de Login). */
const MSG_SIN_CONEXION = 'Sin conexión: conéctate para entrar'
/** Lo que se dice al intentar entrar desde una vista previa de Vercel (el mismo texto de Login): esa página proxia a producción. */
const MSG_VISTA_PREVIA = 'Esta vista previa es solo para revisar el diseño: no se puede iniciar sesión aquí.'

/** El cierre de la hoja de sesión: ninguno. */
const noSeCierra = (): void => {}

export function SesionSheet(): JSX.Element {
  const enLinea = useEnLinea()
  const idFormulario = useId()
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
      if (!(e instanceof ApiError)) console.error('[sesion]', e) // el texto de un error de JavaScript no se le enseña a nadie, pero queda en la consola
      setError(mensajeLogin(e))
      setEnviando(false)
    }
  }

  const alEnviar = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    void entrar()
  }

  return (
    <BottomSheet
      abierto
      onCerrar={noSeCierra}
      titulo="Tu sesión venció"
      // El pie es una columna (BottomSheet.css): la razón del botón deshabilitado sale debajo de él.
      pie={
        <Button type="submit" form={idFormulario} bloque cargando={enviando} disabled={!enLinea} razon={MSG_SIN_CONEXION}>
          Entrar y continuar
        </Button>
      }
    >
      <form id={idFormulario} className="sesion__formulario" onSubmit={alEnviar} noValidate>
        <p className="sesion__texto">Entra otra vez: tu factura no se pierde.</p>

        <TextField
          etiqueta="Usuario o correo"
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

        <div className="sesion__clave">
          <div className="sesion__clave-campo">
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
          {/* El botón de mostrar no le quita el foco al campo (con `mousedown` sin efecto): el teclado sigue abierto mientras se revisa lo escrito. */}
          <Button
            variante="texto"
            className="sesion__ver"
            aria-controls={idClave}
            aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setVerClave(!verClave)}
          >
            {verClave ? 'Ocultar' : 'Mostrar'}
          </Button>
        </div>

        {error !== null && <Banner tono="danger">{error}</Banner>}
      </form>
    </BottomSheet>
  )
}
