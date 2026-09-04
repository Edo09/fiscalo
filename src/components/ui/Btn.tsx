// Botón con variantes, tamaños e iconos opcionales.
import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'

export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 'danger' para acciones destructivas confirmadas (la clase .btn-danger
      ya existia en styles.css; faltaba exponerla en el tipo). */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'lg' | ''
  icon?: IconName
  iconRight?: IconName
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
