// Toggle y checkbox controlados.
import { Icon } from './Icon'

export interface SwitchProps {
  on: boolean
  onChange?: (value: boolean) => void
}
export function Switch({ on, onChange }: SwitchProps) {
  return <span className={'switch' + (on ? ' on' : '')} onClick={() => onChange?.(!on)}></span>
}
export function Checkbox({ on, onChange }: SwitchProps) {
  return (
    <span
      className={'checkbox' + (on ? ' on' : '')}
      onClick={(e) => { e.stopPropagation(); onChange?.(!on) }}
    >
      {on && <Icon name="check" size={12} />}
    </span>
  )
}
