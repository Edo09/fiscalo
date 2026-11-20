// Formato de las fechas que devuelve la API. Sin imports: scripts/test-fechas-api.ts lo carga con `node`
// tal cual. El resto de la app lo usa desde '@/api' (mappers.ts lo re-exporta).

/** Formatea fechas de la API (`dd-mm-yyyy`, `yyyy-mm-dd hh:mm:ss`, ISO). */
export function formatApiDate(value?: string | null): string {
  if (!value) return '—'
  const s = value.trim()
  const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s)
  const yyyymmdd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  let d: Date
  if (ddmmyyyy) {
    d = new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]))
  } else if (yyyymmdd) {
    // Una fecha sin hora es un día del calendario, no un instante: new Date('2027-12-31') la lee como
    // medianoche UTC y en RD (UTC−4) caía el día anterior. Se arma como fecha local, igual que dd-mm-yyyy.
    const [anio, mes, dia] = [Number(yyyymmdd[1]), Number(yyyymmdd[2]) - 1, Number(yyyymmdd[3])]
    d = new Date(anio, mes, dia)
    // Un día que no existe (2027-02-30) no se corre al mes siguiente: se devuelve el texto, como antes.
    if (d.getMonth() !== mes || d.getDate() !== dia) return s
  } else {
    d = new Date(s.replace(' ', 'T'))
  }
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}
