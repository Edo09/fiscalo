// Icono (Lucide) referenciado por nombre kebab-case.
import type { CSSProperties } from 'react'
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
