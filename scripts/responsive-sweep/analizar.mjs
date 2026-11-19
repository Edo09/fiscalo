// Lee los resultados del barrido (<carpeta>/<label>/<pantalla>@<tamano>.json) y los resume o compara.
// Uso: node scripts/responsive-sweep/analizar.mjs <comando> [argumentos] [--out=<carpeta>]
// La carpeta por defecto es <carpeta temporal>/fiscalo-sweep (o la variable SWEEP_OUT). Ver README.md.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const opciones = Object.fromEntries(
  argv.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.slice(2).split('=')
    return [k, v ?? true]
  }),
)
const [cmd, ...args] = argv.filter((a) => !a.startsWith('--'))
const RAIZ = path.resolve(String(opciones.out || process.env.SWEEP_OUT || path.join(os.tmpdir(), 'fiscalo-sweep')))
const ORDEN = ['1920x1080', '1536x864', '1440x900', '1366x720', '1366x620', '1280x720', '1024x768', '768x1024', '390x844']
const LEYENDA = 'banderas: H = algo se sale por el lado, C = texto recortado, M = el dialogo no cabe, X = la pantalla se cayo, N = no termino de cargar'

const pad = (s, n) => String(s).padEnd(n)
const rpad = (s, n) => String(s).padStart(n)

function uso() {
  console.log(`uso: node analizar.mjs <comando> [argumentos] [--out=<carpeta>]
  balance <A> <B>            totales por tamano (scroll vertical, pantallas con problemas, controles), A -> B
  comparar <A> <B>           scroll vertical de cada pantalla, A -> B, y las banderas que cambian
  identico <A> <B> [tamano]  compara cada rectangulo de cada elemento (1920x1080 por defecto): no debe cambiar ninguno
  resumen <A>                scroll vertical y banderas de cada pantalla, por tamano
  problemas <A> [tamano]     desbordes, recortes y dialogos que no caben, uno por uno
  modales <A> <B>            scroll interno y encaje de cada dialogo y cajon, A -> B
  muestras <A> <pantalla>    medidas de barra, filas, campos... en cada tamano de ventana
Los resultados se leen de ${RAIZ}`)
}

/** { pantalla: { tamano: medicion } } de una corrida. */
function carga(label) {
  const dir = path.join(RAIZ, String(label))
  if (!label || !fs.existsSync(dir)) {
    console.error(`No hay resultados en ${dir}. Corriste sweep.start({ label: '${label ?? '...'}' }) con el mock arriba?`)
    process.exit(1)
  }
  const out = {}
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    ;(out[m.screen] ??= {})[m.size] = m
  }
  return out
}

const tamanos = (D) => ORDEN.filter((s) => Object.values(D).some((x) => x[s]))
const hayDesborde = (m) => (m.hScroll || 0) > 0 || (m.docHScroll || 0) > 0 || (m.overflowN || 0) > 0
const modalMalo = (m) => !!m.modal && (!m.modal.fitsV || !m.modal.fitsH || m.modal.footVisible === false)

function banderas(m) {
  let s = ''
  if (m.crashed) s += 'X'
  if (m.listo === false) s += 'N'
  if (hayDesborde(m)) s += 'H'
  if ((m.clippedN || 0) > 0) s += 'C'
  if (modalMalo(m)) s += 'M'
  return s
}

function resumen([label]) {
  const d = carga(label)
  const sizes = tamanos(d)
  const total = Object.fromEntries(sizes.map((s) => [s, 0]))
  console.log(pad('pantalla', 24) + sizes.map((s) => rpad(s, 12)).join(''))
  for (const [sc, porTam] of Object.entries(d)) {
    console.log(pad(sc, 24) + sizes.map((s) => {
      const m = porTam[s]
      if (!m) return rpad('-', 12)
      total[s] += m.vScroll || 0
      return rpad((m.vScroll ?? 0) + (banderas(m) ? ' ' + banderas(m) : ''), 12)
    }).join(''))
  }
  console.log(pad('SUMA scroll vertical', 24) + sizes.map((s) => rpad(total[s], 12)).join(''))
  console.log(LEYENDA)
}

function problemas([label, tam]) {
  const d = carga(label)
  let hay = false
  for (const [sc, porTam] of Object.entries(d)) {
    for (const s of ORDEN) {
      const m = porTam[s]
      if (!m || (tam && s !== tam)) continue
      const items = [
        ...(m.listo === false ? ['no termino de cargar (el mock tiene ese endpoint? el texto del paso existe?)'] : []),
        ...(m.crashed ? ['la pantalla se cayo (ErrorBoundary)'] : []),
        ...(m.hScroll > 0 ? [`scroll horizontal en .content: +${m.hScroll}`] : []),
        ...(modalMalo(m) ? ['dialogo que no cabe: ' + JSON.stringify(m.modal)] : []),
        ...(m.overflow || []).map((x) => 'se sale ' + x),
        ...(m.clipped || []).map((x) => 'recortado ' + x),
        ...(m.cut || []).map((x) => 'cortado ' + x),
      ]
      if (items.length) { hay = true; console.log(pad(sc, 22) + s + '\n  ' + items.join('\n  ')) }
    }
  }
  if (!hay) console.log('Sin problemas' + (tam ? ' en ' + tam : ''))
}

function comparar([a, b]) {
  const A = carga(a)
  const B = carga(b)
  const sizes = tamanos(A)
  const ta = Object.fromEntries(sizes.map((s) => [s, 0]))
  const tb = { ...ta }
  console.log(pad('pantalla', 24) + sizes.map((s) => rpad(s, 17)).join(''))
  for (const sc of Object.keys(A)) {
    console.log(pad(sc, 24) + sizes.map((s) => {
      const x = A[sc][s]
      const y = B[sc]?.[s]
      if (!x || !y) return rpad('-', 17)
      ta[s] += x.vScroll || 0
      tb[s] += y.vScroll || 0
      const fx = banderas(x)
      const fy = banderas(y)
      return rpad((x.vScroll || 0) + '>' + (y.vScroll || 0) + (fx !== fy ? ` [${fx || '.'}>${fy || '.'}]` : ''), 17)
    }).join(''))
  }
  console.log(pad('SUMA', 24) + sizes.map((s) => rpad(`${ta[s]}>${tb[s]} (${ta[s] ? Math.round((tb[s] / ta[s] - 1) * 100) : 0}%)`, 17)).join(''))
  console.log(LEYENDA)
}

function identico([a, b, tam]) {
  const A = carga(a)
  const B = carga(b)
  const size = tam || '1920x1080'
  let distintas = 0
  for (const sc of Object.keys(A)) {
    const x = A[sc][size]?.rects
    const y = B[sc]?.[size]?.rects
    if (!x || !y) {
      console.log(pad(sc, 24) + `sin rectangulos guardados en ${size} (solo se guardan en 1920x1080, 768x1024 y 390x844)`)
      continue
    }
    let dif = 0
    const ejemplos = []
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === y[i]) continue
      dif++
      if (ejemplos.length < 4) ejemplos.push(`${i}: ${x[i]}  ->  ${y[i]}`)
    }
    if (dif) { distintas++; console.log(pad(sc, 24) + `${dif} de ${Math.max(x.length, y.length)} elementos cambian\n   ${ejemplos.join('\n   ')}`) }
    else console.log(pad(sc, 24) + `identico (${x.length} elementos)`)
  }
  console.log(distintas ? `\n${distintas} pantallas con diferencias` : `\nTODO IDENTICO en ${size}`)
}

function muestras([label, pantalla]) {
  const d = carga(label)[pantalla]
  if (!d) { console.error(`No hay pantalla "${pantalla}" en ${label}.`); process.exit(1) }
  for (const s of ORDEN) {
    const m = d[s]
    if (!m) continue
    console.log(pad(s, 11), JSON.stringify({
      navbar: m.navbarH, sidebar: m.sidebarW, pagePad: m.pagePad, head: m.pageHeadH, title: m.pageTitleFs, ...m.smp,
      minCtl: m.minCtlH, minFont: m.minFont, vScroll: m.vScroll,
    }))
  }
}

function modales([a, b]) {
  const A = carga(a)
  const B = carga(b)
  const sizes = ['1366x720', '1366x620', '1280x720', '1024x768', '768x1024', '390x844']
  console.log(pad('estado', 18) + sizes.map((s) => rpad(s, 19)).join(''))
  for (const sc of Object.keys(A).filter((k) => /^(m|d)-/.test(k))) {
    console.log(pad(sc, 18) + sizes.map((s) => {
      const x = A[sc][s]?.modal
      const y = B[sc]?.[s]?.modal
      if (!x || !y) return rpad('-', 19)
      const f = (m) => (m.bodyScroll ?? 0) + (m.fitsV && m.fitsH && m.footVisible !== false ? '' : '!')
      return rpad(`${f(x)}>${f(y)} (${Math.round(x.h)}>${Math.round(y.h)})`, 19)
    }).join(''))
  }
  console.log('celda: scroll interno del cuerpo antes>despues (alto del dialogo); ! = no cabe en la ventana')
}

function balance([a, b]) {
  const A = carga(a)
  const B = carga(b)
  const agg = (D, s) => {
    const r = { v: 0, H: 0, C: 0, M: 0, X: 0, N: 0, u24: 0, minCtl: Infinity, minFont: Infinity }
    for (const porTam of Object.values(D)) {
      const m = porTam[s]
      if (!m) continue
      r.v += m.vScroll || 0
      if (hayDesborde(m)) r.H++
      if ((m.clippedN || 0) > 0) r.C++
      if (modalMalo(m)) r.M++
      if (m.crashed) r.X++
      if (m.listo === false) r.N++
      r.u24 += m.under24 || 0
      if (m.minCtlH != null) r.minCtl = Math.min(r.minCtl, m.minCtlH)
      if (m.minFont != null) r.minFont = Math.min(r.minFont, m.minFont)
    }
    return r
  }
  const mostrar = (n) => (Number.isFinite(n) ? n : '-')
  console.log(pad('tamano', 11) + rpad('scroll vertical total', 26) + rpad('desborde H', 12) + rpad('recorte', 9) + rpad('dialogo no cabe', 17) + rpad('caidas', 8) + rpad('sin cargar', 12) + rpad('ctl<24px', 10) + rpad('ctl min', 12) + rpad('letra min', 13))
  for (const s of tamanos(A)) {
    const x = agg(A, s)
    const y = agg(B, s)
    const pct = x.v ? Math.round((y.v / x.v - 1) * 100) : 0
    console.log(
      pad(s, 11) + rpad(`${x.v} > ${y.v} (${pct > 0 ? '+' : ''}${pct}%)`, 26) + rpad(`${x.H} > ${y.H}`, 12) + rpad(`${x.C} > ${y.C}`, 9)
      + rpad(`${x.M} > ${y.M}`, 17) + rpad(`${x.X} > ${y.X}`, 8) + rpad(`${x.N} > ${y.N}`, 12) + rpad(`${x.u24} > ${y.u24}`, 10)
      + rpad(`${mostrar(x.minCtl)} > ${mostrar(y.minCtl)}`, 12) + rpad(`${mostrar(x.minFont)} > ${mostrar(y.minFont)}`, 13),
    )
  }
}

const COMANDOS = { balance, comparar, identico, resumen, problemas, modales, muestras }
if (!COMANDOS[cmd]) {
  uso()
  process.exit(cmd ? 1 : 0)
}
COMANDOS[cmd](args)
