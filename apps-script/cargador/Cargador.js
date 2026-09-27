/**
 * Precios de Mercado · cargador del script de Google.
 *
 * Se pega UNA sola vez en Apps Script (en lugar del Code.js largo). El código de la app se baja solo de las
 * versiones publicadas en github.com/robinszuniga/precios-mercado, se guarda en las propiedades del script y se
 * renueva solo: cada mañana con el trabajo diario, cada 6 horas al usar la app y con "Actualizar ahora" en Ajustes.
 * No necesita la API de Apps Script ni volver a implementar: la URL /exec y el token no cambian nunca.
 */

var PM_CARGADOR = 1
var PM_REPO = 'robinszuniga/precios-mercado'
var PM_BASE = 'https://github.com/' + PM_REPO + '/releases/latest/download/'
// Los permisos de appsscript.json: una versión que pida otros no se instala sola (Google no la dejaría correr).
var PM_PERMISOS = [
  'https://www.googleapis.com/auth/spreadsheets.currentonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/script.scriptapp',
]
// Cada propiedad guarda hasta 9 kB; 2800 caracteres caben aunque todos ocupen 3 bytes.
var PM_TROZO = 2800
var PM_REVISAR_CADA_S = 6 * 60 * 60
var pmApp__ = null
var pmResultado__ = null // lo que dio revisar en esta ejecución (no se baja dos veces)

// ── Lo que llaman la app web, los triggers y el editor ──────────────────────────────────────────────────────
function doGet(e) { return pmWeb_(function (app) { return app.doGet(e) }) }
function doPost(e) { return pmWeb_(function (app) { return app.doPost(e) }) }
function inicializarHoja(e) { return pmApp_().inicializarHoja(e) }
function probarTiendas(e) { return pmApp_().probarTiendas(e) }
function autoprueba(e) { return pmApp_().autoprueba(e) }
function tareaDiaria(e) { return pmApp_().tareaDiaria(e) }
function continuarPrecios(e) { return pmApp_().continuarPrecios(e) }
function onEdit(e) {
  // Al editar el Sheet a mano no se descarga nada: solo se usa el código ya guardado.
  var app = pmApp_({ soloGuardado: true })
  if (app) return app.onEdit(e)
}

/** Ejecutar desde el editor: baja e instala ya la última versión publicada. */
function actualizarme() {
  var r = pmActualizar_()
  console.log((r.estado === 'actualizado' || r.estado === 'al_dia' ? '✔ ' : '✘ ') + r.mensaje)
  return r
}

// ── Cargar ──────────────────────────────────────────────────────────────────────────────────────────────────
function pmApp_(opciones) {
  opciones = opciones || {}
  if (pmApp__) return pmApp__
  var props = PropertiesService.getScriptProperties()
  if (opciones.revisar) pmRevisarSiToca_()
  var codigo = pmLeer_(props.getProperties())
  if (!codigo) {
    if (opciones.soloGuardado) return null
    var r = pmResultado__ || pmActualizar_()
    codigo = pmLeer_(props.getProperties())
    if (!codigo) throw new Error('No se pudo bajar el código de la app. ' + r.mensaje)
  }
  pmApp__ = pmEvaluar_(codigo)
  return pmApp__
}

/** La app web siempre recibe JSON, aunque el código no se haya podido cargar. */
function pmWeb_(fn) {
  var app
  try {
    app = pmApp_({ revisar: true })
  } catch (e) {
    var r = { ok: false, data: null, error: { codigo: 'interno', mensaje: String(e && e.message || e) }, v: 1 }
    return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON)
  }
  return fn(app)
}

function pmEvaluar_(codigo) {
  // Se evalúa dentro de una función: sus declaraciones no pisan las de este cargador.
  var app = new Function(codigo + '\n;return typeof __app === "undefined" ? null : __app;')()
  if (!app || typeof app.doPost !== 'function') throw new Error('el código bajado no trae la app')
  return app
}

function pmPuntero_(todas) {
  try { return todas.PM_CODIGO ? JSON.parse(todas.PM_CODIGO) : null } catch (e) { return null }
}

function pmLeer_(todas) {
  var p = pmPuntero_(todas)
  if (!p || !(p.partes > 0)) return null
  var partes = []
  for (var i = 0; i < p.partes; i++) {
    var t = todas['PM_CODIGO_' + i]
    if (t == null) return null
    partes.push(t)
  }
  var codigo = partes.join('')
  return codigo.length === p.largo ? codigo : null
}

// ── Actualizar ──────────────────────────────────────────────────────────────────────────────────────────────
function pmRevisarSiToca_() {
  try {
    var cache = CacheService.getScriptCache()
    if (cache.get('PM_REVISADO')) return
    cache.put('PM_REVISADO', '1', PM_REVISAR_CADA_S)
    pmActualizar_()
  } catch (e) {
    // Revisar nunca tumba una petición de la app.
  }
}

/** Baja la última versión publicada si es distinta de la guardada. Deja el resultado en ACTUALIZACION. */
function pmActualizar_() {
  var props = PropertiesService.getScriptProperties()
  var todas = props.getProperties()
  var guardada = pmPuntero_(todas)
  var actual = guardada && pmLeer_(todas) ? guardada.version : null
  var nueva = null
  function fin(estado, mensaje) {
    var r = { estado: estado, actual: actual || 'ninguna', nueva: nueva, mensaje: mensaje, fecha: new Date().toISOString(), cargador: PM_CARGADOR }
    props.setProperty('ACTUALIZACION', JSON.stringify(r))
    pmResultado__ = r
    return r
  }
  try {
    var info = JSON.parse(pmBajar_('version.json'))
    nueva = info.version
    if (!nueva) throw new Error('version.json no dice la versión')
    if (nueva === actual) return fin('al_dia', 'Al día (' + nueva + ').')
    var faltan = (info.permisos || []).filter(function (x) { return PM_PERMISOS.indexOf(x) < 0 })
    if (faltan.length) {
      return fin('necesita_permiso', 'La versión ' + nueva + ' necesita permisos nuevos: en Apps Script reemplaza appsscript.json por el de esa versión y ejecuta "actualizarme".')
    }
    var codigo = pmBajar_('Code.js')
    // Que sea de verdad esta app y que arranque, antes de reemplazar la que funciona.
    if (codigo.indexOf(PM_REPO) < 0 || !/function doPost\(/.test(codigo)) throw new Error('el Code.js bajado no parece de esta app')
    pmEvaluar_(codigo)
    pmGuardar_(props, todas, codigo, nueva)
    return fin('actualizado', actual ? 'Actualizado de ' + actual + ' a ' + nueva + '.' : 'Instalada la versión ' + nueva + '.')
  } catch (e) {
    return fin('error', 'No se pudo actualizar: ' + String(e && e.message || e))
  }
}

function pmBajar_(archivo) {
  var r = UrlFetchApp.fetch(PM_BASE + archivo, { muteHttpExceptions: true, followRedirects: true })
  if (r.getResponseCode() !== 200) throw new Error(archivo + ': HTTP ' + r.getResponseCode())
  return r.getContentText('UTF-8')
}

function pmGuardar_(props, todas, codigo, version) {
  var nuevas = {}
  var n = 0
  for (var i = 0; i < codigo.length; n++) {
    var fin = Math.min(i + PM_TROZO, codigo.length)
    // No partir un emoji (par sustituto) entre dos propiedades.
    var c = codigo.charCodeAt(fin - 1)
    if (fin < codigo.length && c >= 0xd800 && c <= 0xdbff) fin--
    nuevas['PM_CODIGO_' + n] = codigo.slice(i, fin)
    i = fin
  }
  nuevas.PM_CODIGO = JSON.stringify({ version: version, partes: n, largo: codigo.length, fecha: new Date().toISOString() })
  // Trozos y puntero en una sola escritura: quien lea a la vez ve la versión vieja o la nueva, nunca una mezcla.
  props.setProperties(nuevas)
  Object.keys(todas).forEach(function (k) {
    var m = /^PM_CODIGO_(\d+)$/.exec(k)
    if (m && Number(m[1]) >= n) props.deleteProperty(k)
  })
}
