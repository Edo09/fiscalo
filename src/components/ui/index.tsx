// FISCALO — Primitivas UI compartidas (tipadas).
import {
  useEffect,
  useRef,
  useState,
  Fragment,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  LayoutDashboard, Bell, BellOff, FileText, FilePlus, FileMinus,
  Users, User, UserPlus, UserCheck, UserX, Package, BadgeCheck, Inbox,
  Receipt, ShoppingCart, Truck, Landmark, BarChart3, Shield, ShieldCheck,
  Settings, LifeBuoy, Menu, ChevronsUpDown, Search, Moon, Sun, Plus, Minus,
  LogOut, Building2, ChevronRight, ChevronLeft, ChevronDown, X, Check,
  CheckCircle, CheckCheck, TrendingUp, TrendingDown, CloudOff, RefreshCw,
  Calendar, Clock, Wallet, Download, Upload, ArrowRight, ArrowLeftRight,
  ArrowDownLeft, ArrowUpRight, Repeat, SlidersHorizontal, Send, Mail, Phone,
  MoreHorizontal, Eye, Edit3, Copy, Ban, Printer, PenTool, Loader, Code,
  Archive, Filter, Server, Save, AlertCircle, AlertTriangle, XCircle, Trash2,
  Wrench, Box, MapPin, CircleDot, HandCoins, Tag, Layers, Percent, Sheet,
  GitCompare, Key, Hash, Pause, Banknote, HelpCircle,
  type LucideIcon,
} from 'lucide-react'
import { fmt, fmt0, colorFor } from '@/lib/format'

/* ---------- Icono (Lucide) ---------- */
const ICONS: Record<string, LucideIcon> = {
  'layout-dashboard': LayoutDashboard, bell: Bell, 'bell-off': BellOff,
  'file-text': FileText, 'file-plus': FilePlus, 'file-minus': FileMinus,
  users: Users, user: User, 'user-plus': UserPlus, 'user-check': UserCheck,
  'user-x': UserX, package: Package, 'badge-check': BadgeCheck, inbox: Inbox,
  receipt: Receipt, 'shopping-cart': ShoppingCart, truck: Truck,
  landmark: Landmark, 'bar-chart-3': BarChart3, shield: Shield,
  'shield-check': ShieldCheck, settings: Settings, 'life-buoy': LifeBuoy,
  menu: Menu, 'chevrons-up-down': ChevronsUpDown, search: Search, moon: Moon,
  sun: Sun, plus: Plus, minus: Minus, 'log-out': LogOut, 'building-2': Building2,
  'chevron-right': ChevronRight, 'chevron-left': ChevronLeft,
  'chevron-down': ChevronDown, x: X, check: Check, 'check-circle': CheckCircle,
  'check-check': CheckCheck, 'trending-up': TrendingUp,
  'trending-down': TrendingDown, 'cloud-off': CloudOff, 'refresh-cw': RefreshCw,
  calendar: Calendar, clock: Clock, wallet: Wallet, download: Download,
  upload: Upload, 'arrow-right': ArrowRight, 'arrow-left-right': ArrowLeftRight,
  'arrow-down-left': ArrowDownLeft, 'arrow-up-right': ArrowUpRight, repeat: Repeat,
  'sliders-horizontal': SlidersHorizontal, send: Send, mail: Mail, phone: Phone,
  'more-horizontal': MoreHorizontal, eye: Eye, 'edit-3': Edit3, copy: Copy,
  ban: Ban, printer: Printer, 'pen-tool': PenTool, loader: Loader, code: Code,
  archive: Archive, filter: Filter, server: Server, save: Save,
  'alert-circle': AlertCircle, 'alert-triangle': AlertTriangle, 'x-circle': XCircle,
  'trash-2': Trash2, wrench: Wrench, box: Box, 'map-pin': MapPin,
  'circle-dot': CircleDot, 'hand-coins': HandCoins, tag: Tag, layers: Layers,
  percent: Percent, sheet: Sheet, 'git-compare': GitCompare, key: Key, hash: Hash,
  pause: Pause, banknote: Banknote, 'help-circle': HelpCircle,
}

export interface IconProps {
  name: string
  size?: number
  className?: string
  style?: CSSProperties
}
export function Icon({ name, size = 18, className = '', style }: IconProps) {
  const Cmp = ICONS[name] ?? HelpCircle
  return <Cmp size={size} className={'lucide ic ' + className} style={style} />
}

/* ---------- Botón ---------- */
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

/* ---------- Money ---------- */
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

/* ---------- Badge ---------- */
export type BadgeTone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger'
export interface BadgeProps {
  tone?: BadgeTone
  dot?: boolean
  children?: ReactNode
  className?: string
}
export function Badge({ tone = 'neutral', dot = false, children, className = '' }: BadgeProps) {
  return (
    <span className={`badge badge-${tone} ${className}`}>
      {dot && <span className="dotp"></span>}
      {children}
    </span>
  )
}

export const ESTADO_TONE: Record<string, BadgeTone> = {
  Emitida: 'info', Pagada: 'success', Borrador: 'neutral', Vencida: 'danger', Anulada: 'neutral',
  Aceptado: 'success', 'En proceso': 'warning', Rechazado: 'danger', Pendiente: 'neutral', Anulado: 'neutral',
  'Al día': 'success', Vencido: 'danger', 'Por vencer': 'warning', Activo: 'success', Inactivo: 'neutral',
  Disponible: 'success', Bajo: 'warning', Agotado: 'danger', Pagado: 'success',
  // Estados del módulo de Gastos
  Registrado: 'info', 'Por emitir': 'warning', Error: 'danger',
}
export function EstadoBadge({ estado }: { estado: string }) {
  return <Badge tone={ESTADO_TONE[estado] ?? 'neutral'} dot>{estado}</Badge>
}

/* ---------- Avatar ---------- */
export interface AvatarProps {
  name?: string
  color?: string
  size?: number
  className?: string
}
export function Avatar({ name, color, size = 30, className = '' }: AvatarProps) {
  const ini = name
    ? name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    : '?'
  const c = color || colorFor(name || 'x')
  return (
    <span
      className={'avatar ' + className}
      style={{ background: c, width: size, height: size, fontSize: size * 0.4 }}
    >
      {ini}
    </span>
  )
}

/* ---------- Card ---------- */
export interface CardProps {
  title?: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  noPad?: boolean
}
export function Card({ title, sub, actions, children, className = '', noPad = false }: CardProps) {
  return (
    <div className={'card ' + className}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      <div className={noPad ? '' : 'card-pad'}>{children}</div>
    </div>
  )
}

/* ---------- KPI ---------- */
export interface KpiProps {
  label: string
  value: number | string
  money?: boolean
  icon?: string
  iconBg?: string
  iconColor?: string
  delta?: string
  deltaDir?: 'up' | 'down'
  foot?: ReactNode
}
export function KPI({
  label, value, money = false, icon,
  iconBg = 'var(--accent-soft)', iconColor = 'var(--accent)',
  delta, deltaDir = 'up', foot,
}: KpiProps) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {icon && (
          <span className="kpi-ic" style={{ background: iconBg, color: iconColor }}>
            <Icon name={icon} size={16} />
          </span>
        )}
      </div>
      <div className="kpi-value">
        {money && typeof value === 'number'
          ? <Money value={value} />
          : <span className="num">{typeof value === 'number' ? fmt0(value) : value}</span>}
      </div>
      <div className="kpi-foot">
        {delta != null && (
          <span className={`delta ${deltaDir}`}>
            <Icon name={deltaDir === 'up' ? 'trending-up' : 'trending-down'} size={13} />
            {delta}
          </span>
        )}
        {foot && <span>{foot}</span>}
      </div>
    </div>
  )
}

/* ---------- Toggle / Checkbox ---------- */
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

/* ---------- Tabs / Segmented ---------- */
export interface TabItem {
  id: string
  label: ReactNode
  count?: number
}
export interface TabsProps {
  tabs: TabItem[]
  active: string
  onChange: (id: string) => void
}
export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={'tab' + (active === t.id ? ' on' : '')}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count != null && (
            <span className="muted-3" style={{ marginLeft: 6, fontWeight: 500 }}>{t.count}</span>
          )}
        </div>
      ))}
    </div>
  )
}
export interface SegProps {
  options: string[]
  value: string
  onChange: (value: string) => void
}
export function Seg({ options, value, onChange }: SegProps) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o} className={value === o ? 'on' : ''} onClick={() => onChange(o)}>{o}</button>
      ))}
    </div>
  )
}

/* ---------- Modal ---------- */
export interface ModalProps {
  title: ReactNode
  sub?: ReactNode
  icon?: string
  children?: ReactNode
  footer?: ReactNode
  onClose: () => void
  width?: number
}
export function Modal({ title, sub, icon, children, footer, onClose, width = 520 }: ModalProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          {icon && (
            <span className="kpi-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', width: 34, height: 34 }}>
              <Icon name={icon} size={18} />
            </span>
          )}
          <div style={{ flex: 1 }}>
            <h3>{title}</h3>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <Btn variant="ghost" size="sm" icon="x" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/* ---------- Drawer ---------- */
export interface DrawerProps {
  title: ReactNode
  sub?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  onClose: () => void
  width?: number
}
export function Drawer({ title, sub, children, footer, onClose, width = 560 }: DrawerProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <Fragment>
      <div className="drawer-overlay" onClick={onClose}></div>
      <div className="drawer" style={{ maxWidth: width }}>
        <div className="drawer-head">
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 16 }}>{title}</h3>
            {sub && <div className="sub" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{sub}</div>}
          </div>
          <Btn variant="ghost" size="sm" icon="x" onClick={onClose} />
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </Fragment>
  )
}

/* ---------- Dropdown menu ---------- */
export interface DropdownProps {
  trigger: ReactNode
  children?: ReactNode
  align?: 'left' | 'right'
  width?: number
}
export function Dropdown({ trigger, children, align = 'right', width = 200 }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const menuStyle: CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    minWidth: width,
    ...(align === 'right' ? { right: 0 } : { left: 0 }),
  }
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div className="menu" style={menuStyle} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  )
}
export interface MenuItemProps {
  icon?: string
  children?: ReactNode
  danger?: boolean
  onClick?: () => void
}
export function MenuItem({ icon, children, danger, onClick }: MenuItemProps) {
  return (
    <div className={'menu-item' + (danger ? ' danger' : '')} onClick={onClick}>
      {icon && <Icon name={icon} size={15} />}{children}
    </div>
  )
}

/* ---------- Estados ---------- */
export interface EmptyStateProps {
  icon?: string
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
}
export function EmptyState({ icon = 'inbox', title, children, action }: EmptyStateProps) {
  return (
    <div className="state">
      <div className="state-ic"><Icon name={icon} size={24} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}
export function LoadingState({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ padding: '4px 0' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="row" style={{ padding: '11px 14px', gap: 14, borderBottom: '1px solid var(--border)' }}>
          <div className="skel" style={{ width: 32, height: 32, borderRadius: 8 }}></div>
          <div className="skel" style={{ height: 12, flex: 1, maxWidth: 180 }}></div>
          <div className="skel" style={{ height: 12, width: 90 }}></div>
          <div className="skel" style={{ height: 12, width: 70, marginLeft: 'auto' }}></div>
          <div className="skel" style={{ height: 20, width: 64, borderRadius: 99 }}></div>
        </div>
      ))}
    </div>
  )
}
export interface ErrorStateProps {
  title?: string
  children?: ReactNode
  onRetry?: () => void
}
export function ErrorState({ title = 'Algo salió mal', children, onRetry }: ErrorStateProps) {
  return (
    <div className="state">
      <div className="state-ic" style={{ background: 'var(--danger-soft)' }}>
        <Icon name="cloud-off" size={24} style={{ color: 'var(--danger)' }} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {onRetry && <Btn variant="secondary" icon="refresh-cw" onClick={onRetry}>Reintentar</Btn>}
    </div>
  )
}
export function Spinner() {
  return <span className="spinner"></span>
}

/* ---------- Bar chart (una o dos series) ---------- */
export interface BarDatum {
  mes: string
  ventas: number
  gastos?: number
}
export interface BarChartProps {
  data: BarDatum[]
  height?: number
  /** Multiplicador para el tooltip (mock en miles -> 1000; API en pesos -> 1). */
  valueScale?: number
  legend?: { primary: string; secondary?: string }
}
export function BarChart({
  data,
  height = 180,
  valueScale = 1000,
  legend = { primary: 'Ventas', secondary: 'Gastos' },
}: BarChartProps) {
  const hasGastos = data.some((d) => d.gastos != null)
  const max = Math.max(1, ...data.flatMap((d) => [d.ventas, d.gastos ?? 0]))
  return (
    <div>
      <div className="bars" style={{ height }}>
        {data.map((d, i) => (
          <div className="bar-col" key={i} title={`${d.mes}: RD$ ${fmt0(d.ventas * valueScale)}`}>
            <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center', height: '100%', alignItems: 'flex-end', gap: 3 }}>
              <div style={{ width: hasGastos ? '38%' : '60%', maxWidth: 16, height: `${(d.ventas / max) * 100}%`, background: 'var(--accent)', borderRadius: '4px 4px 2px 2px', transition: 'height .5s' }}></div>
              {hasGastos && (
                <div style={{ width: '38%', maxWidth: 16, height: `${((d.gastos ?? 0) / max) * 100}%`, background: 'var(--accent-soft-2)', borderRadius: '4px 4px 2px 2px', transition: 'height .5s' }}></div>
              )}
            </div>
            <span className="bar-label">{d.mes}</span>
          </div>
        ))}
      </div>
      <div className="legend" style={{ marginTop: 14, justifyContent: 'center' }}>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--accent)' }}></span>{legend.primary}</span>
        {hasGastos && legend.secondary && (
          <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--accent-soft-2)' }}></span>{legend.secondary}</span>
        )}
      </div>
    </div>
  )
}

/* ---------- Donut ---------- */
export interface DonutSegment {
  value: number
  color: string
}
export function Donut({ segments, size = 120, thickness = 16 }: { segments: DonutSegment[]; size?: number; thickness?: number }) {
  const r = (size - thickness) / 2
  const circ = 2 * Math.PI * r
  let offset = 0
  const total = segments.reduce((a, s) => a + s.value, 0)
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--neutral-soft)" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = (s.value / total) * circ
          const el = (
            <circle
              key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
              strokeWidth={thickness} strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset} strokeLinecap="butt"
            />
          )
          offset += len
          return el
        })}
      </svg>
    </div>
  )
}

/* ---------- Progress ---------- */
export function Progress({ value, color = 'var(--accent)' }: { value: number; color?: string }) {
  return (
    <div className="progress">
      <div className="progress-fill" style={{ width: `${value}%`, background: color }}></div>
    </div>
  )
}

/* ---------- Sparkline ---------- */
export function Sparkline({ data, color = 'var(--accent)', width = 100, height = 30 }: { data: number[]; color?: string; width?: number; height?: number }) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const pts = data
    .map((d, i) => `${(i / (data.length - 1)) * width},${height - ((d - min) / (max - min || 1)) * height}`)
    .join(' ')
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ---------- Page header ---------- */
export interface Crumb {
  label: ReactNode
  onClick?: () => void
}
export interface PageHeadProps {
  title: ReactNode
  sub?: ReactNode
  crumbs?: Crumb[]
  actions?: ReactNode
}
export function PageHead({ title, sub, crumbs, actions }: PageHeadProps) {
  return (
    <div>
      {crumbs && (
        <div className="breadcrumb">
          {crumbs.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && <Icon name="chevron-right" size={13} className="sep" />}
              <a
                style={{ cursor: c.onClick ? 'pointer' : 'default', color: i === crumbs.length - 1 ? 'var(--text-2)' : 'inherit' }}
                onClick={c.onClick}
              >
                {c.label}
              </a>
            </Fragment>
          ))}
        </div>
      )}
      <div className="page-head">
        <div className="titles">
          <h1 className="page-title">{title}</h1>
          {sub && <div className="page-sub">{sub}</div>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </div>
  )
}
