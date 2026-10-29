// Tema guardado, aplicado antes del primer pintado. Sin storage o con otro valor, manda el sistema.
try {
  var t = localStorage.getItem('express.theme')
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t)
} catch (e) {}
