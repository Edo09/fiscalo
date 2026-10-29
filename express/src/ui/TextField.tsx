// Los campos de texto de Express (anexo 8): `TextField`, `NumericField` y `DateField`. Miden 52 px, con la letra a 16 px (a menos, iOS acerca la página al
// tocarlos), la etiqueta arriba y el mensaje (ayuda o error) debajo. Los números van en `type="text"` con `inputMode`, nunca `type="number"` (que acepta
// la «e», pierde ceros y cambia con la rueda del ratón); las teclas que pide cada dato son cosa del que usa el campo: `modoInput` y `enterkeyhint`.
import { useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Icon } from './Icon'
import './TextField.css'

export interface TextFieldProps {
  etiqueta: string
  valor: string
  onCambio(v: string): void
  /** Un error lo reemplaza a la ayuda, se anuncia a los lectores de pantalla y pone el borde en rojo. */
  error?: string
  ayuda?: string
  tipo?: 'text' | 'search' | 'email' | 'tel' | 'password'
  modoInput?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'search'
  /** La tecla de acción del teclado en pantalla (con `done` o `go` iOS la rotula así; los teclados numéricos de iOS no tienen Intro). */
  enterkeyhint?: 'next' | 'done' | 'search' | 'go'
  autoComplete?: string
  autoCapitalize?: string
  /** Intro en el campo. Con esto el campo se queda con el Intro: no envía el formulario que lo contenga. */
  onEnter?(): void
  /** Un botón de 48 px que borra el texto y deja el foco en el campo. */
  limpiable?: boolean
  disabled?: boolean
  maxLength?: number
  id?: string
}

/** ¿Hay un texto que mostrar? Un mensaje vacío es lo mismo que ninguno. */
const hayTexto = (texto: string | undefined): texto is string => texto !== undefined && texto !== ''

/** Lo común de los tres campos: la etiqueta, la caja (con lo que lleve dentro) y el mensaje de abajo, que es el error y, si no hay, la ayuda. */
function Campo(p: {
  etiqueta: string
  ocultarEtiqueta?: boolean
  idControl: string
  idMensaje: string
  error?: string
  ayuda?: string
  children: ReactNode
}): JSX.Element {
  const { etiqueta, ocultarEtiqueta = false, idControl, idMensaje, error, ayuda, children } = p
  return (
    <div className={hayTexto(error) ? 'campo campo--error' : 'campo'}>
      <label className={ocultarEtiqueta ? 'campo__etiqueta sr-only' : 'campo__etiqueta'} htmlFor={idControl}>
        {etiqueta}
      </label>
      <div className="campo__caja">{children}</div>
      {hayTexto(error) ? (
        <p id={idMensaje} className="campo__mensaje campo__mensaje--error" role="alert">
          {error}
        </p>
      ) : hayTexto(ayuda) ? (
        <p id={idMensaje} className="campo__mensaje">
          {ayuda}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Un campo de texto. En el de búsqueda (`tipo="search"`) la etiqueta no se ve arriba: queda para los lectores de pantalla y se escribe dentro del
 * campo, como marcador de posición («Buscar e-NCF o cliente»), que es lo que se espera de un buscador.
 */
export function TextField(p: TextFieldProps): JSX.Element {
  const { etiqueta, valor, onCambio, error, ayuda, tipo = 'text', modoInput, enterkeyhint, autoComplete, autoCapitalize } = p
  const { onEnter, limpiable = false, disabled = false, maxLength } = p
  const idPropio = useId()
  const id = p.id ?? idPropio
  const idMensaje = `${id}-mensaje`
  const entrada = useRef<HTMLInputElement>(null)
  const busqueda = tipo === 'search'

  const alTeclear = (e: KeyboardEvent<HTMLInputElement>): void => {
    // Con un teclado de composición (japonés, chino, el predictivo de algunos Android) el Intro confirma la palabra que se arma: no es «enviar».
    if (onEnter === undefined || e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    onEnter()
  }

  const borrar = (): void => {
    onCambio('')
    entrada.current?.focus() // el teclado sigue abierto y se puede seguir escribiendo
  }

  return (
    <Campo etiqueta={etiqueta} ocultarEtiqueta={busqueda} idControl={id} idMensaje={idMensaje} error={error} ayuda={ayuda}>
      <input
        ref={entrada}
        id={id}
        className={limpiable ? 'campo__entrada campo__entrada--borrable' : 'campo__entrada'}
        type={tipo}
        value={valor}
        placeholder={busqueda ? etiqueta : undefined}
        disabled={disabled}
        maxLength={maxLength}
        inputMode={modoInput}
        enterKeyHint={enterkeyhint}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        aria-invalid={hayTexto(error) || undefined}
        aria-describedby={hayTexto(error) || hayTexto(ayuda) ? idMensaje : undefined}
        onChange={(e) => onCambio(e.target.value)}
        onKeyDown={alTeclear}
      />
      {limpiable && valor !== '' && !disabled && (
        <button type="button" className="campo__borrar" aria-label="Borrar texto" onClick={borrar}>
          <Icon name="x" size={20} />
        </button>
      )}
    </Campo>
  )
}

export type NumericFieldProps = Omit<TextFieldProps, 'tipo' | 'modoInput'> & {
  /** Cuántos decimales admite. Sin él (o con 0) solo enteros, con el teclado numérico; con 1 o más, el teclado decimal. */
  decimales?: number
}

/**
 * Lo que queda de lo escrito en un campo numérico, o null si el cambio se rechaza y el campo conserva su valor.
 * La coma pasa a punto (los teclados decimales de varios teléfonos la ponen) y lo que no es un dígito se descarta, sea una letra tecleada o el
 * guion de un RNC pegado. Con decimales, a lo sumo un punto y `decimales` dígitos después: lo que no cabe se rechaza entero y no se recorta, porque
 * recortar un «1,200.50» pegado daría «1.20050», un valor mil veces menor sin que nadie lo note, y rechazarlo deja el campo como estaba, a la vista.
 */
function limpiarNumero(texto: string, decimales: number): string | null {
  const conPunto = texto.replace(/,/g, '.')
  if (decimales < 1) return conPunto.replace(/[^0-9]/g, '')
  const limpio = conPunto.replace(/[^0-9.]/g, '')
  const partes = limpio.split('.')
  if (partes.length > 2 || (partes.length === 2 && partes[1].length > decimales)) return null
  return limpio
}

/**
 * Un campo para números: `type="text"` con `inputMode` `numeric` o `decimal`, y solo admite dígitos (y el punto decimal si hay `decimales`).
 * `maxLength` se cuenta sobre lo que queda tras limpiar y no se le pasa al `input`: el navegador lo aplica al texto crudo, y un RNC pegado con guiones
 * («RNC: 1-31-00000-1») perdería dígitos al cortarlo en 11 caracteres antes de que se quiten los guiones. Como en los decimales, lo que no cabe se
 * rechaza entero.
 */
export function NumericField(p: NumericFieldProps): JSX.Element {
  const { decimales, maxLength, onCambio, ...resto } = p
  const admitidos = decimales === undefined ? 0 : Math.trunc(decimales)
  const alCambiar = (v: string): void => {
    const limpio = limpiarNumero(v, admitidos)
    if (limpio === null || (maxLength !== undefined && limpio.length > maxLength)) return
    onCambio(limpio)
  }
  return <TextField {...resto} tipo="text" modoInput={admitidos < 1 ? 'numeric' : 'decimal'} onCambio={alCambiar} />
}

export interface DateFieldProps {
  etiqueta: string
  /** `AAAA-MM-DD`, o vacío. */
  valor: string
  onCambio(v: string): void
  /** `AAAA-MM-DD`: la fecha más temprana que deja elegir el selector. Sale de `hoy()` (lib/reloj), nunca de `toISOString`. */
  min?: string
  max?: string
  error?: string
}

/** Un campo de fecha: el `input type="date"` nativo (el selector del teléfono), sin calendario propio. */
export function DateField(p: DateFieldProps): JSX.Element {
  const { etiqueta, valor, onCambio, min, max, error } = p
  const id = useId()
  const idMensaje = `${id}-mensaje`
  return (
    <Campo etiqueta={etiqueta} idControl={id} idMensaje={idMensaje} error={error}>
      <input
        id={id}
        className="campo__entrada campo__entrada--fecha"
        type="date"
        value={valor}
        min={min}
        max={max}
        aria-invalid={hayTexto(error) || undefined}
        aria-describedby={hayTexto(error) ? idMensaje : undefined}
        onChange={(e) => onCambio(e.target.value)}
      />
    </Campo>
  )
}
