// Motivos de ajuste de inventario: el valor crudo viaja a la API, la etiqueta
// es lo que lee el usuario. Vive aparte de las vistas para que ambas pantallas
// (listado y creación) compartan exactamente la misma lista.
import type { MotivoAjuste } from '@/api'

export const MOTIVOS: { value: MotivoAjuste; label: string }[] = [
  { value: 'CONTEO_FISICO', label: 'Conteo físico' },
  // Los dos que SUMAN existencia sin ser una corrección: lo que llega al almacén
  // (y el aviso de "no hay existencia" abre Ajuste con este) y el saldo con que
  // arranca un producto. Antes solo había motivos que no decían eso (spec control
  // de existencias, C8). El API los acepta desde esa misma entrega.
  { value: 'ENTRADA', label: 'Entrada de mercancía' },
  { value: 'INVENTARIO_INICIAL', label: 'Inventario inicial' },
  { value: 'MERMA', label: 'Merma' },
  { value: 'DANO', label: 'Daño' },
  { value: 'ROBO', label: 'Robo o pérdida' },
  { value: 'DEVOLUCION', label: 'Devolución' },
  { value: 'ERROR_CAPTURA', label: 'Error de captura' },
  { value: 'OTRO', label: 'Otro' },
]

/** ANULACION no se ofrece al crear: solo aparece en ajustes generados por el sistema. */
export const motivoLabel = (m?: string | null) =>
  MOTIVOS.find((x) => x.value === m)?.label ?? (m === 'ANULACION' ? 'Anulación' : (m ?? '—'))
