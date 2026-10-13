// Avisos para quien administra el e-CF (GET /api/facturas/avisos; spec del POS y
// "Reenviar a la DGII" sobre el write-ahead, 4.6). Salen en el panel de e-CF de
// la app y nunca en la caja. Aquí está lo que dice cada uno. Sin React:
// scripts/test-avisos-ecf.ts lo prueba con Node.
//
// Imports de valor SOLO por ruta relativa con .ts (Node los carga tal cual);
// lo de '@/…' va solo como `import type`, que Node borra.
import type { AvisosEcf } from '@/api'
import { ECF_TIPOS } from '../../config/ecf.ts'

export interface AvisoEcf {
  /** Estable: clave de React y de las pruebas. */
  clave: string
  tono: 'warning' | 'danger'
  icono: 'alert-triangle' | 'alert-circle' | 'clock'
  titulo: string
  detalle: string
  /** true = lleva el botón que abre Rangos (registrar un rango autorizado). */
  accionRangos: boolean
}

export const TEXTO_CERTIFICADO =
  'Esas ventas no son comprobantes fiscales: no tienen e-NCF, no llevan ITBIS y no se enviaron a la DGII. Revisa el certificado digital; cuando funcione, las ventas nuevas vuelven a salir como e-CF. Consulta con tu contador cómo regularizarlas.'
export const TEXTO_AGOTADA =
  'No quedan números libres en un rango autorizado. Registra el nuevo rango para poder emitir este tipo de comprobante.'
export const TEXTO_SIN_RANGO =
  'Se imprimieron con el número siguiente al último de su rango y todavía no se enviaron a la DGII. Se envían solas cuando registres un rango autorizado que incluya esos números.'

/** "E31 · Factura de Crédito Fiscal"; solo el código si el tipo no está en el catálogo. */
function etiquetaTipo(tipo: string): string {
  const nombre = ECF_TIPOS.find((t) => t.code === tipo.replace(/^E/i, ''))?.nombre
  return nombre ? `${tipo} · ${nombre}` : tipo
}

/** Entero >= 0; lo que no es un número (o llega vacío) cuenta como 0. */
function entero(v: unknown): number {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Los avisos que hay que mostrar, en este orden: certificado, secuencias (en el
 * orden de la API) y ventas esperando un rango. Tolera datos que faltan o una
 * API anterior que no tiene la ruta (contesta otra cosa): sin avisos.
 */
export function listarAvisos(a: Partial<AvisosEcf> | null | undefined): AvisoEcf[] {
  const avisos: AvisoEcf[] = []

  const simples = entero(a?.certificado_fallo?.ventas_hoy)
  if (simples > 0) {
    avisos.push({
      clave: 'certificado',
      tono: 'danger',
      icono: 'alert-triangle',
      titulo: simples === 1
        ? 'El certificado falló: 1 venta del POS salió como factura simple'
        : `El certificado falló: ${simples} ventas del POS salieron como factura simple`,
      detalle: TEXTO_CERTIFICADO,
      accionRangos: false,
    })
  }

  for (const s of a?.secuencias ?? []) {
    const etiqueta = etiquetaTipo(String(s.tipo ?? ''))
    if (s.estado === 'agotada') {
      avisos.push({
        clave: `secuencia-${s.tipo}`,
        tono: 'danger',
        icono: 'alert-circle',
        titulo: `Secuencia agotada: ${etiqueta}`,
        detalle: TEXTO_AGOTADA,
        accionRangos: true,
      })
    } else if (s.estado === 'pocos') {
      const n = entero(s.restantes)
      const cuantos = n === 1 ? 'Queda 1' : n > 1 ? `Quedan ${n}` : 'Quedan pocos'
      avisos.push({
        clave: `secuencia-${s.tipo}`,
        tono: 'warning',
        icono: 'alert-triangle',
        titulo: `Quedan pocos números de ${etiqueta}`,
        detalle: `${cuantos} en el rango vigente. Registra el siguiente rango autorizado antes de que se acaben.`,
        accionRangos: true,
      })
    }
  }

  const sinRango = entero(a?.sin_rango?.ventas)
  if (sinRango > 0) {
    avisos.push({
      clave: 'sin-rango',
      tono: 'warning',
      icono: 'clock',
      titulo: sinRango === 1
        ? '1 venta esperando un rango autorizado'
        : `${sinRango} ventas esperando un rango autorizado`,
      detalle: TEXTO_SIN_RANGO,
      accionRangos: true,
    })
  }

  return avisos
}
