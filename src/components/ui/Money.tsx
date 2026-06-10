// Cantidad monetaria formateada (RD$).
import { fmt } from '@/lib/format'

export interface MoneyProps {
  value: number
  cur?: boolean
  className?: string
  sign?: boolean
}
export function Money({ value, cur = true, className = '', sign = false }: MoneyProps) {
  const neg = value < 0
  const v = fmt(Math.abs(value))
  return (
    <span className={'num ' + className}>
      {neg ? '−' : sign && value > 0 ? '+' : ''}
      {cur && <span className="cur">RD$</span>}{v}
    </span>
  )
}
