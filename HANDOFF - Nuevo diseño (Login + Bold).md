# Fiscalo — Handoff de rediseño (Login branded + Capa "Bold")

> **Para:** Claude (Opus 5.8) implementando sobre el código real de Fiscalo.
> **Objetivo:** aplicar el nuevo diseño construido en el prototipo encima de la versión "vieja" ya integrada.
> **Naturaleza del cambio:** mayormente una **capa CSS aditiva no destructiva** (`bold.css`) + un **rediseño del login** + **3 ediciones puntuales** en `app.jsx`. No reescribe vistas ni componentes.

---

## 0. Resumen de lo que hay que aplicar

| # | Cambio | Archivos | Riesgo |
|---|--------|----------|--------|
| 1 | Cargar fuente **Space Grotesk** + nueva hoja `bold.css` | `index.html` | bajo |
| 2 | Crear **`bold.css`** (capa de restyle global: sidebar "ink", tipografía display, KPIs, cards, tablas, botones, badges) | `bold.css` (nuevo) | bajo |
| 3 | Rediseño del **login** a pantalla dividida con panel de marca | `views_login.jsx` (reemplazo) + bloque CSS de login en `styles.css` | medio |
| 4 | Wiring en `app.jsx`: gating de auth + renombrar opciones del tweak de sidebar | `app.jsx` (3 ediciones) | medio |

**Premisas del código base** (deben cumplirse; son las del sistema Fiscalo):
- Existe `styles.css` con las clases compartidas: `.sidebar`, `.nav-item`, `.kpi`, `.kpi-value`, `.card`, `.card-head`, `.tbl`, `.badge`, `.btn`, `.btn-primary`, `.page-title`, `.navbar`, `.seg`, `.tab`, `.filter-chip`, `.search-input`, `.progress-fill`, `.avatar`.
- Las vistas se cargan como scripts Babel y comparten primitivas globales `Icon`, `Btn`, y `const { useState, useEffect, useRef } = React`.
- El sidebar admite las clases modificadoras `.sb-compact` y `.sb-contrast`.

**Requisito de navegador:** `bold.css` usa `color-mix(in oklab, …)` y `mask-image`. Soportado en Chrome/Edge 111+, Safari 16.2+, Firefox 113+. Si necesitas soportar navegadores más viejos, ver §6 (fallbacks).

---

## 1. `index.html` — cargar fuente y hoja Bold

En `<head>`, **después** del `<link>` de `styles.css`, deja exactamente esto:

```html
  <title>Fiscalo — Facturación Electrónica RD</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" />
  <link rel="stylesheet" href="styles.css" />
  <link rel="stylesheet" href="bold.css" />
```

> **Orden importa:** `bold.css` debe ir **después** de `styles.css` — toda la capa gana por cascada (misma especificidad, declarada después). Si tu build concatena CSS, asegúrate de que el contenido de `bold.css` quede al final del bundle.

---

## 2. Crear `bold.css` (capa de restyle global)

Archivo **nuevo**. Es lo que transforma todas las pantallas de golpe (vive de las clases compartidas). Cópialo tal cual:

```css
/* ============================================================
   FISCALO — CAPA "BOLD" (restyle distintivo)
   Se carga DESPUÉS de styles.css y sobre-escribe por cascada.
   Aesthetic: fiscal-grade, ink chrome, display type, acento con cuerpo.
   ============================================================ */

:root {
  --font-display: "Space Grotesk", "Helvetica Neue", Helvetica, sans-serif;

  /* Paleta "ink" del panel de marca (login) llevada al shell */
  --ink: #1a2034;
  --ink-1: #232a44;
  --ink-2: #1d2338;
  --ink-line: rgba(255,255,255,0.08);
  --ink-line-2: rgba(255,255,255,0.05);
  --ink-text: #cdd6e6;
  --ink-text-2: #8a96b3;
  --ink-text-3: #5d6685;

  /* radios un poco más definidos */
  --r-lg: 14px;
  --r-xl: 20px;

  /* sombras con más cuerpo */
  --sh-xs: 0 1px 2px rgba(15, 20, 40, 0.05);
  --sh-sm: 0 1px 3px rgba(15, 20, 40, 0.07), 0 1px 2px rgba(15, 20, 40, 0.05);
  --sh-md: 0 6px 16px rgba(15, 20, 40, 0.09), 0 2px 5px rgba(15, 20, 40, 0.05);
  --sh-lg: 0 16px 40px rgba(15, 20, 40, 0.14), 0 5px 12px rgba(15, 20, 40, 0.06);
}

/* ---- Tipografía display ---- */
h1, h2, h3,
.page-title, .brand-name, .kpi-value, .login-headline, .login-title,
.modal-head h3, .state h3 {
  font-family: var(--font-display);
  letter-spacing: -0.025em;
}
.page-title { font-size: 25px; font-weight: 600; }
.kpi-value { font-feature-settings: "tnum"; font-variant-numeric: tabular-nums; }
.brand-name { font-weight: 600; }

/* ============================================================
   SHELL — fondo y aire
   ============================================================ */
.content { background:
  radial-gradient(120% 60% at 100% 0%, color-mix(in oklab, var(--accent) 5%, transparent), transparent 60%),
  var(--bg);
}

/* ============================================================
   SIDEBAR — ink por defecto (lleva el panel de marca al shell)
   ============================================================ */
.sidebar {
  background:
    linear-gradient(180deg, var(--ink-1) 0%, var(--ink-2) 55%, var(--ink) 100%);
  border-right: 1px solid rgba(0,0,0,0.4);
  position: relative;
}
.sidebar::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(var(--ink-line-2) 1px, transparent 1px),
    linear-gradient(90deg, var(--ink-line-2) 1px, transparent 1px);
  background-size: 38px 38px;
  mask-image: radial-gradient(120% 70% at 50% 0%, #000 10%, transparent 70%);
  opacity: 0.7;
}
.sidebar > * { position: relative; z-index: 1; }

.sidebar-brand { border-bottom: 1px solid var(--ink-line); }
.sidebar .brand-name { color: #f3f6fc; }
.sidebar .brand-name b { color: color-mix(in oklab, var(--accent) 65%, #fff); }
.sidebar .brand-mark { box-shadow: 0 4px 14px rgba(0,0,0,0.45); }

.sidebar .nav-group-label { color: #6f7a96; letter-spacing: 0.09em; }
.sidebar .nav-item { color: var(--ink-text); font-weight: 500; border-radius: var(--r-sm); }
.sidebar .nav-item .lucide { color: #6f7a96; }
.sidebar .nav-item:hover { background: rgba(255,255,255,0.055); color: #fff; }
.sidebar .nav-item:hover .lucide { color: var(--ink-text); }

.sidebar .nav-item.active {
  background: linear-gradient(90deg, color-mix(in oklab, var(--accent) 26%, transparent), color-mix(in oklab, var(--accent) 10%, transparent));
  color: #fff; font-weight: 600;
}
.sidebar .nav-item.active .lucide { color: color-mix(in oklab, var(--accent) 55%, #fff); }
.sidebar .nav-item.active::before {
  content: ""; position: absolute; left: -10px; top: 50%; transform: translateY(-50%);
  width: 3px; height: 18px; border-radius: 0 3px 3px 0;
  background: color-mix(in oklab, var(--accent) 70%, #fff);
  box-shadow: 0 0 10px color-mix(in oklab, var(--accent) 60%, transparent);
}
.sidebar .nav-item { position: relative; }

.sidebar-foot { border-top: 1px solid var(--ink-line); }
.sidebar-foot .nav-item { background: rgba(255,255,255,0.05) !important; }
.sidebar-foot .nav-item:hover { background: rgba(255,255,255,0.09) !important; }

/* ---- Tweak "compacto" sólo cambia densidad (hereda ink) ---- */
.sidebar.sb-compact { --sidebar-w: 212px; }

/* ---- Tweak "claro" (sb-contrast): sidebar claro alternativo ---- */
.sidebar.sb-contrast {
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
}
.sidebar.sb-contrast::before { display: none; }
.sidebar.sb-contrast .sidebar-brand,
.sidebar.sb-contrast .sidebar-foot { border-color: var(--border); }
.sidebar.sb-contrast .brand-name { color: var(--text); }
.sidebar.sb-contrast .brand-name b { color: var(--accent); }
.sidebar.sb-contrast .nav-group-label { color: var(--text-3); }
.sidebar.sb-contrast .nav-item { color: var(--text-2); }
.sidebar.sb-contrast .nav-item .lucide { color: var(--text-3); }
.sidebar.sb-contrast .nav-item:hover { background: var(--surface-hover); color: var(--text); }
.sidebar.sb-contrast .nav-item:hover .lucide { color: var(--text-2); }
.sidebar.sb-contrast .nav-item.active { background: var(--accent-soft); color: var(--accent-text); }
.sidebar.sb-contrast .nav-item.active .lucide { color: var(--accent); }
.sidebar.sb-contrast .nav-item.active::before { background: var(--accent); box-shadow: none; }
.sidebar.sb-contrast .sidebar-foot .nav-item { background: var(--surface-hover) !important; }

/* ============================================================
   NAVBAR — refinado
   ============================================================ */
.navbar { background: color-mix(in oklab, var(--surface) 88%, transparent); backdrop-filter: saturate(1.1) blur(8px); }
.co-switch { border-radius: var(--r-md); }
.co-logo { background: linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 60%, #000)); color: #fff; font-weight: 700; }
.navbar-search { border-radius: var(--r-md); }

/* ============================================================
   PAGE HEADER
   ============================================================ */
.page-head .titles { position: relative; }
.page-title { line-height: 1.1; }

/* ============================================================
   KPI / STAT CARDS — riel de acento + numerales display
   ============================================================ */
.kpi {
  border-radius: var(--r-lg);
  border-color: var(--border);
  background:
    linear-gradient(180deg, color-mix(in oklab, var(--surface) 100%, transparent), var(--surface));
  transition: transform .16s cubic-bezier(.2,.8,.2,1), box-shadow .16s, border-color .16s;
}
.kpi::after {
  content: ""; position: absolute; left: 0; right: 0; top: 0; height: 3px;
  background: linear-gradient(90deg, var(--accent), color-mix(in oklab, var(--accent) 35%, transparent));
  opacity: 0; transition: opacity .16s;
}
.kpi:hover { transform: translateY(-2px); box-shadow: var(--sh-md); border-color: var(--border-strong); }
.kpi:hover::after { opacity: 1; }
.kpi-value { font-size: 23px; }
.kpi-ic { border-radius: 9px; }

/* ============================================================
   CARDS
   ============================================================ */
.card { border-radius: var(--r-lg); box-shadow: var(--sh-sm); }
.card-head h3 { font-family: var(--font-display); letter-spacing: -0.02em; font-size: 14.5px; white-space: nowrap; }

/* ============================================================
   BUTTONS — primario con cuerpo
   ============================================================ */
.btn { border-radius: var(--r-sm); font-weight: 600; }
.btn-primary {
  background: linear-gradient(180deg, color-mix(in oklab, var(--accent) 92%, #fff) 0%, var(--accent) 55%, var(--accent-active) 100%);
  box-shadow: 0 1px 2px rgba(15,20,40,0.18), inset 0 1px 0 rgba(255,255,255,0.22);
  border-color: color-mix(in oklab, var(--accent-active) 80%, #000);
}
.btn-primary:hover { filter: brightness(1.04); }
.btn-primary:active { filter: brightness(0.96); }

/* ============================================================
   TABLES — encabezado y hover con acento
   ============================================================ */
.tbl thead th { background: var(--surface-2); font-size: 11px; letter-spacing: 0.04em; }
.tbl tbody tr:hover { background: color-mix(in oklab, var(--accent) 5%, var(--surface)); }
.tbl tbody tr { position: relative; }
.cell-main { font-weight: 600; }

/* ============================================================
   BADGES / PILLS / TAGS
   ============================================================ */
.badge { border: 1px solid color-mix(in oklab, currentColor 22%, transparent); }
.ecf-tag { font-family: var(--font-mono); border: 1px solid var(--border); background: var(--surface-2); }

/* ============================================================
   SEGMENTED / TABS
   ============================================================ */
.seg button.on { box-shadow: var(--sh-sm); }
.tab.on { border-bottom-width: 2.5px; }

/* ============================================================
   FILTER CHIPS / SEARCH
   ============================================================ */
.filter-chip { border-radius: var(--r-sm); }
.search-input { border-radius: var(--r-md); }

/* ============================================================
   AVATAR
   ============================================================ */
.avatar, .avatar-sm { box-shadow: inset 0 1px 0 rgba(255,255,255,0.25); }

/* ============================================================
   PROGRESS / BARS
   ============================================================ */
.progress-fill { background: linear-gradient(90deg, color-mix(in oklab, var(--accent) 70%, #000), var(--accent)); }

/* ============================================================
   DARK MODE — ajustes finos
   ============================================================ */
[data-theme="dark"] .sidebar { background: linear-gradient(180deg, #0e1018 0%, #0b0d14 100%); border-right-color: #000; }
[data-theme="dark"] .content { background:
  radial-gradient(120% 60% at 100% 0%, color-mix(in oklab, var(--accent) 8%, transparent), transparent 60%),
  var(--bg); }
[data-theme="dark"] .navbar { background: color-mix(in oklab, var(--surface) 82%, transparent); }
```

### Notas de diseño (para entender intención, no para alterar)
- **Sidebar "ink":** es un slate-navy (`#232a44 → #1d2338 → #1a2034`), no negro. Ya está afinado por feedback del usuario ("un poco más claro"). No lo oscurezcas.
- **El acento sigue siendo `var(--accent)`** del sistema → todo respeta el tweak de color de acento (azul/verde/violeta/teal) sin tocar nada.
- **Tipografía:** Space Grotesk **solo** en títulos, marca, headers de card y números grandes (`.kpi-value`). El body y las tablas se quedan en la fuente del sistema para densidad/legibilidad. No cambies la fuente del body.

---

## 3. Login rediseñado (pantalla dividida con panel de marca)

### 3a. Reemplaza por completo `views_login.jsx`

Depende de `Icon`, `Btn` y `const { useState, useEffect, useRef } = React` (ya globales en el sistema). El handler `onLogin` y el estado de auth los provee `app.jsx` (§4).

```jsx
/* ============================================================
   FISCALO — Pantalla de inicio de sesión
   ============================================================ */

function Login({ onLogin }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const userRef = useRef(null);

  useEffect(() => { userRef.current && userRef.current.focus(); }, []);

  const submit = (e) => {
    e.preventDefault();
    const errs = {};
    if (!user.trim()) errs.user = "Ingresa tu correo o usuario.";
    if (!pass) errs.pass = "Ingresa tu contraseña.";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setLoading(true);
    setTimeout(() => onLogin(), 600);   // ← reemplazar por la llamada real de auth
  };

  return (
    <div className="login-wrap" data-screen-label="Login">

      {/* ---- Panel de marca (izquierda) ---- */}
      <aside className="login-aside">
        <div className="login-aside-grid" aria-hidden="true"></div>
        <div className="login-aside-glow" aria-hidden="true"></div>

        <div className="login-aside-top">
          <div className="login-brand">
            <div className="brand-mark login-mark">F</div>
            <span className="brand-name">Fiscalo<b>.</b></span>
          </div>
        </div>

        <div className="login-aside-mid">
          <div className="login-ecf-badge">
            <span className="login-ecf-dot"></span>
            Comprobante e-CF · 31
          </div>
          <h1 className="login-headline">Tu facturación fiscal,<br />en orden y al día.</h1>
          <p className="login-tagline">Emite, firma y transmite tus comprobantes electrónicos a la DGII desde un solo lugar.</p>

          <ul className="login-feats">
            <li><span className="login-feat-ic"><Icon name="zap" size={15} /></span>Emisión de e-CF en segundos</li>
            <li><span className="login-feat-ic"><Icon name="shield-check" size={15} /></span>Validación automática con la DGII</li>
            <li><span className="login-feat-ic"><Icon name="line-chart" size={15} /></span>Reportes de ITBIS siempre al día</li>
          </ul>
        </div>

        <div className="login-aside-foot">
          <span className="login-status-dot"></span>
          Conectado a la DGII · Ambiente de Certificación
        </div>
      </aside>

      {/* ---- Formulario (derecha) ---- */}
      <main className="login-main">
        <div className="login-card">
          <div className="login-brand login-brand-mobile">
            <div className="brand-mark login-mark">F</div>
            <span className="brand-name">Fiscalo<b>.</b></span>
          </div>

          <h2 className="login-title">Bienvenido de nuevo</h2>
          <p className="login-sub">Inicia sesión para continuar con tu facturación.</p>

          <form onSubmit={submit} noValidate>
            <div className={"field" + (errors.user ? " field-error" : "")}>
              <label htmlFor="login-user">Correo o usuario</label>
              <input
                id="login-user"
                ref={userRef}
                className="input"
                type="text"
                autoComplete="username"
                placeholder="ana.reyes@distcaribe.do"
                value={user}
                onChange={(e) => { setUser(e.target.value); if (errors.user) setErrors({ ...errors, user: null }); }}
              />
              {errors.user && <div className="err-msg"><Icon name="circle-alert" size={13} />{errors.user}</div>}
            </div>

            <div className={"field" + (errors.pass ? " field-error" : "")}>
              <div className="login-pass-row">
                <label htmlFor="login-pass">Contraseña</label>
                <a href="#" className="login-forgot" onClick={(e) => e.preventDefault()}>¿Olvidaste tu contraseña?</a>
              </div>
              <div className="login-pass-wrap">
                <input
                  id="login-pass"
                  className="input"
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={pass}
                  onChange={(e) => { setPass(e.target.value); if (errors.pass) setErrors({ ...errors, pass: null }); }}
                />
                <button
                  type="button"
                  className="login-pass-toggle"
                  title={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                  onClick={() => setShowPass(!showPass)}
                  tabIndex={-1}
                >
                  <Icon name={showPass ? "eye-off" : "eye"} size={16} />
                </button>
              </div>
              {errors.pass && <div className="err-msg"><Icon name="circle-alert" size={13} />{errors.pass}</div>}
            </div>

            <Btn variant="primary" type="submit" className="login-submit" disabled={loading} icon={loading ? "loader-2" : null}>
              {loading ? "Iniciando…" : "Iniciar sesión"}
            </Btn>
          </form>

          <p className="login-foot">Facturación Electrónica · DGII · República Dominicana</p>
        </div>
      </main>
    </div>
  );
}

window.Login = Login;
```

> **Integración con auth real:** sustituye `setTimeout(() => onLogin(), 600)` por tu request real (validar credenciales, manejar error de servidor mostrándolo con la misma clase `.err-msg`, y llamar `onLogin()` al éxito).

### 3b. Bloque CSS del login

Si tu `styles.css` actual **ya** tiene una sección `LOGIN`, **reemplázala** por esto. Si no existe, **agrégalo** (puede ir al final de `styles.css` o dentro de `bold.css` — el resultado es idéntico). Usa `var(--accent)` así que respeta el acento.

```css
/* ============================================================
   LOGIN — pantalla dividida con panel de marca
   ============================================================ */
.login-wrap {
  min-height: 100%;
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  background: var(--surface);
}

/* ---- Panel de marca (izquierda) ---- */
.login-aside {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 44px 52px;
  color: #eaf0fb;
  background:
    radial-gradient(120% 90% at 12% 8%, color-mix(in oklab, var(--accent) 55%, #0b1020) 0%, transparent 55%),
    linear-gradient(155deg, #11162a 0%, #0c1020 60%, #090c18 100%);
}
.login-aside-grid {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(110% 80% at 80% 100%, #000 20%, transparent 75%);
  pointer-events: none;
}
.login-aside-glow {
  position: absolute;
  width: 460px; height: 460px;
  right: -140px; bottom: -160px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in oklab, var(--accent) 60%, transparent) 0%, transparent 70%);
  filter: blur(8px);
  opacity: 0.5;
  pointer-events: none;
}
.login-aside-top, .login-aside-mid, .login-aside-foot { position: relative; z-index: 1; }

.login-aside .brand-mark { box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
.login-aside .brand-name { color: #fff; font-size: 20px; }

.login-aside-mid { max-width: 420px; }
.login-ecf-badge {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 600; letter-spacing: 0.01em;
  color: #cdd9f2;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  padding: 5px 11px; border-radius: var(--r-full);
  margin-bottom: 22px;
}
.login-ecf-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #44d391; box-shadow: 0 0 0 3px rgba(68,211,145,0.18);
}
.login-headline {
  font-size: 33px; line-height: 1.12; letter-spacing: -0.02em;
  font-weight: 650; color: #fff; margin: 0 0 14px;
  text-wrap: balance;
}
.login-tagline { font-size: 15px; line-height: 1.55; color: #aab6d0; margin: 0 0 30px; }
.login-feats { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 13px; }
.login-feats li { display: flex; align-items: center; gap: 12px; font-size: 14px; color: #d7e0f1; }
.login-feat-ic {
  display: grid; place-items: center;
  width: 30px; height: 30px; flex: none;
  border-radius: var(--r-sm);
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.10);
  color: color-mix(in oklab, var(--accent) 50%, #fff);
}
.login-aside-foot {
  display: flex; align-items: center; gap: 9px;
  font-size: 12px; color: #8a96b3;
}
.login-status-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #44d391;
  box-shadow: 0 0 8px rgba(68,211,145,0.7);
  animation: login-pulse 2.4s ease-in-out infinite;
}
@keyframes login-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

/* ---- Formulario (derecha) ---- */
.login-main {
  display: grid;
  place-items: center;
  padding: 40px 32px;
  background: var(--bg);
}
.login-card { width: 100%; max-width: 372px; }
.login-brand-mobile { display: none; margin-bottom: 26px; }
.login-mark { width: 36px; height: 36px; border-radius: 10px; font-size: 18px; }
.login-brand { display: flex; align-items: center; gap: 10px; }
.login-title { font-size: 24px; letter-spacing: -0.02em; margin: 0; }
.login-sub { font-size: 14px; color: var(--text-2); margin: 7px 0 28px; }
.login-pass-row { display: flex; align-items: baseline; justify-content: space-between; }
.login-forgot { font-size: 12.5px; color: var(--accent-text); text-decoration: none; font-weight: 500; }
.login-forgot:hover { text-decoration: underline; }
.login-pass-wrap { position: relative; }
.login-pass-wrap .input { padding-right: 40px; }
.login-pass-toggle {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: 38px;
  display: grid; place-items: center;
  background: none; border: none;
  color: var(--text-3);
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
}
.login-pass-toggle:hover { color: var(--text-2); }
.login-submit { width: 100%; justify-content: center; margin-top: 8px; height: 42px; font-size: 14.5px; }
.login-submit .lucide { animation: login-spin 0.9s linear infinite; }
@keyframes login-spin { to { transform: rotate(360deg); } }
.login-foot { font-size: 11.5px; color: var(--text-3); margin-top: 28px; text-align: center; }

@media (max-width: 860px) {
  .login-wrap { grid-template-columns: 1fr; }
  .login-aside { display: none; }
  .login-brand-mobile { display: flex; }
}
```

> El panel del login conserva un ink **más profundo** (`#11162a → #090c18`) que el sidebar — es intencional: es una pantalla de marca con glow. No lo igualer al sidebar.

---

## 4. `app.jsx` — wiring (3 ediciones)

> Si tu `app.jsx` real ya difiere del prototipo, **adapta el patrón**, no copies literal. Lo esencial es: (a) renderizar `<Login>` cuando no hay sesión, (b) renombrar las opciones del tweak de sidebar.

### 4a. Estado de auth + render condicional
El login se monta cuando no hay sesión; al autenticar se muestra el shell. En el prototipo se persiste en `localStorage`; en producción usa tu fuente de verdad de sesión (token/cookie/contexto).

```jsx
// estado
const [authed, setAuthed] = useState(() => localStorage.getItem("fiscalo.auth") === "1");

// handlers
const login  = () => { setAuthed(true);  localStorage.setItem("fiscalo.auth", "1"); };
const logout = () => { setAuthed(false); localStorage.setItem("fiscalo.auth", "0"); nav("dashboard"); };

// gate: antes de renderizar el shell
if (!authed) {
  return (
    <React.Fragment>
      <Login onLogin={login} />
      {tweaksPanel}   {/* opcional: solo si usas el panel de Tweaks */}
    </React.Fragment>
  );
}
```

Y conecta el `logout` al item existente del menú de usuario:

```jsx
<MenuItem icon="log-out" danger onClick={logout}>Cerrar sesión</MenuItem>
```

### 4b. Renombrar opciones del tweak de Sidebar (si usas el panel de Tweaks)
El sidebar ahora es **ink por defecto**. La opción que antes era `contraste` (sidebar oscuro) ahora se llama `claro` (sidebar claro alternativo), porque oscuro pasó a ser el default.

```jsx
// default
const TWEAK_DEFAULTS = { /* … */ "sidebarStyle": "ink", /* … */ };

// mapeo de clase
const sbClass =
  t.sidebarStyle === "claro"    ? " sb-contrast" :
  t.sidebarStyle === "compacto" ? " sb-compact"  : "";

// control del panel
<TweakRadio label="Estilo" value={t.sidebarStyle}
  options={["ink", "compacto", "claro"]}
  onChange={(v) => setTweak("sidebarStyle", v)} />
```

> Si **no** usas el panel de Tweaks en producción: omite §4b por completo. El sidebar ink es el default y no necesita nada. La clase `.sb-contrast` queda disponible por si algún día quieres exponer el sidebar claro.

---

## 5. Checklist de verificación

- [ ] `index.html` carga Space Grotesk y `bold.css` **después** de `styles.css`.
- [ ] Sidebar se ve slate-navy con textura de grilla tenue; el item activo tiene barra de acento a la izquierda.
- [ ] Títulos de página, headers de card y números KPI usan Space Grotesk; el body/tablas no.
- [ ] KPI cards levantan en hover y muestran el riel de acento superior.
- [ ] Botón primario tiene degradado/relieve; tablas con hover teñido de acento.
- [ ] Login: panel de marca a la izquierda, formulario a la derecha; en < 860px el panel se oculta y aparece el logo móvil.
- [ ] Toggle ojo de contraseña, validación inline y estado "Iniciando…" funcionan.
- [ ] Modo oscuro (`[data-theme="dark"]`) se ve coherente.
- [ ] El tweak de color de acento (azul/verde/violeta/teal) sigue tiñendo todo, incluido sidebar y login.
- [ ] `logout` lleva de vuelta al login.

---

## 6. Fallbacks (solo si necesitas navegadores viejos)

`bold.css` usa `color-mix()`. Si debes soportar Safari < 16.2 / Chrome < 111, reemplaza cada `color-mix(in oklab, var(--accent) X%, …)` por un valor RGBA fijo equivalente del acento por defecto (azul `#2a6fdb`), p. ej.:
- `color-mix(in oklab, var(--accent) 5%, var(--surface))` → `rgba(42,111,219,0.05)` sobre `var(--surface)`.
- Riel/active del sidebar → usa `rgba(42,111,219,0.22)`.

Trade-off: pierdes el re-tintado automático al cambiar el acento. Para la mayoría de despliegues modernos **no hace falta**; `color-mix` ya tiene soporte amplio en 2026.

---

## 7. Resumen de archivos

| Archivo | Acción |
|---------|--------|
| `index.html` | editar `<head>`: +Space Grotesk, +`bold.css` |
| `bold.css` | **crear** (§2) |
| `views_login.jsx` | **reemplazar** (§3a) |
| `styles.css` | reemplazar/insertar bloque LOGIN (§3b) |
| `app.jsx` | 3 ediciones (§4) |

Nada más se toca. Las demás vistas (`Dashboard`, `Facturación`, `Clientes`, `e-CF`, `Bandeja DGII`, `Reportes`, `Configuración`, etc.) adoptan el nuevo look automáticamente por compartir las clases globales.
