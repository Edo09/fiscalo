// Botón con variantes, tamaños e iconos opcionales.
import type { ButtonHTMLAttributes } from 'react'
import { Icon } from './Icon'

export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'lg' | ''
  icon?: string
  iconRight?: string
}
export function Btn({
  variant = 'secondary', size = '', icon, iconRight, children, className = '', ...rest
}: BtnProps) {
  const sz = size === 'sm' ? ' btn-sm' : size === 'lg' ? ' btn-lg' : ''
  const only = !children ? ' btn-icon' : ''
  return (
    <button className={`btn btn-${variant}${sz}${only} ${className}`} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </button>
  )
}
