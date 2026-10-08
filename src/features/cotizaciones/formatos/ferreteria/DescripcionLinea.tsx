import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

/**
 * Descripción que crece con el texto: el PDF la imprime entera (hasta 1000
 * caracteres) y en pantalla tampoco se corta. Sin saltos de línea: en el PDF y
 * al facturar la descripción es un solo párrafo, así que Enter no hace nada y
 * un texto pegado con saltos queda en una sola línea.
 *
 * La usan las líneas de la cotización de Ferretería y las del conduce.
 */
export function DescripcionLinea({
  value, onValue, ...rest
}: {
  value: string
  onValue: (v: string) => void
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onValue(e.target.value.replace(/\s*[\r\n]+\s*/g, ' '))}
      onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
    />
  )
}
