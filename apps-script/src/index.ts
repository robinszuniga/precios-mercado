import { CONFIG_POR_DEFECTO, leerConfig } from '../../shared/src/config.ts'
import { TABLAS, TABLAS_SYNC, type NombreTabla } from '../../shared/src/esquema.ts'
import { isoBogota } from '../../shared/src/fechas.ts'
import { TIENDAS_VTEX } from '../../shared/src/tiendas.ts'
import { candidatosDeProductos, clasificarRespuesta } from '../../shared/src/vtex/parse.ts'
import { urlBusqueda } from '../../shared/src/vtex/urls.ts'
import * as A from './acciones.ts'
import { aplicarCambios, registrar } from './datos.ts'
import { asegurarEsquema } from './gas/hojaRepo.ts'
import { abrirHoja, serviciosGas } from './gas/servicios.ts'
import { obtenerContextos } from './regiones.ts'
import { manejarGet, manejarPost, type Respuesta } from './router.ts'

function json(r: Respuesta) {
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON)
}

function fallaGrave(e: unknown): Respuesta {
  return { ok: false, data: null, error: { codigo: 'interno', mensaje: String(e) }, v: 1, srv: isoBogota(Date.now()) }
}

export function doGet(_e: GoogleAppsScript.Events.DoGet) {
  try { return json(manejarGet(serviciosGas())) } catch (e) { return json(fallaGrave(e)) }
}

export function doPost(e: GoogleAppsScript.Events.DoPost) {
  try { return json(manejarPost(serviciosGas(), e?.postData?.contents ?? '')) } catch (err) { return json(fallaGrave(err)) }
}

/** Ejecutar una vez desde el editor: crea las pestañas, la configuración, el token y el trigger diario. */
export function inicializarHoja() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() ?? abrirHoja()
  const props = PropertiesService.getScriptProperties()
  props.setProperty('SHEET_ID', ss.getId())
  ss.setSpreadsheetTimeZone('America/Bogota')
  ss.setSpreadsheetLocale('es_CO')
  const hechos = asegurarEsquema(ss)

  const s = serviciosGas()
  const ahora = s.reloj.ahora()
  const existentes = new Set(s.repo.leer('Config').map((f) => String(f.clave)))
  const faltan = Object.entries(CONFIG_POR_DEFECTO).filter(([k]) => !existentes.has(k))
  if (faltan.length) {
    aplicarCambios(s, faltan.map(([clave, valor]) => ({ tabla: 'Config', fila: { clave, valor, updated_at: ahora } })), new Set(['Config']))
    hechos.push(`Config: ${faltan.map(([k]) => k).join(', ')}`)
  }

  let token = props.getProperty('TOKEN')
  if (!token) {
    token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '')
    props.setProperty('TOKEN', token)
    hechos.push('token nuevo')
  }
  const cfg = leerConfig(s.repo.leer('Config') as { clave: string; valor: string }[])
  s.triggers.asegurarDiario(cfg.horaTrigger)
  // Se nombra aquí para que el editor pida el permiso de conexiones externas desde el principio.
  if (typeof UrlFetchApp === 'undefined') throw new Error('UrlFetchApp no disponible')

  console.log(hechos.length ? `Hecho: ${hechos.join(' · ')}` : 'Todo estaba al día.')
  console.log(`TOKEN (pégalo en Ajustes de la app): ${token}`)
  console.log('Siguiente paso: ejecuta probarTiendas y luego Implementar → Nueva implementación → Aplicación web.')
  return { hechos, token }
}

/** Ejecutar desde el editor: dice si Google puede consultar cada tienda y resuelve la región de Riohacha. */
export function probarTiendas() {
  const s = serviciosGas()
  const salida: Record<string, unknown> = {}
  for (const t of TIENDAS_VTEX) {
    const [r] = s.http.todas([{ url: urlBusqueda(t, { ft: 'arroz', hasta: 4 }), cabeceras: { Accept: 'application/json' } }])
    const c = clasificarRespuesta(r.status, r.cuerpo)
    const cands = c.tipo === 'ok' ? candidatosDeProductos(t, c.productos) : []
    const muestra = cands[0]
    const linea = c.tipo === 'ok'
      ? `✔ ${t}: HTTP ${r.status}, ${cands.length} SKUs. Ej.: ${muestra?.nombre} = ${muestra?.precio}`
      : `✘ ${t}: HTTP ${r.status} → ${c.motivo}. ${r.cuerpo.slice(0, 150)}`
    console.log(linea)
    salida[t] = { status: r.status, ok: c.tipo === 'ok', skus: cands.length }
  }
  const cfg = leerConfig(s.repo.leer('Config') as { clave: string; valor: string }[])
  const ctx = obtenerContextos(s, cfg, [...TIENDAS_VTEX])
  if (ctx.cambiosConfig.length) {
    const ahora = s.reloj.ahora()
    s.lock.con(30_000, () => aplicarCambios(s, ctx.cambiosConfig.map((c) => ({ tabla: 'Config', fila: { ...c, updated_at: ahora } })), new Set(['Config'])))
  }
  for (const t of TIENDAS_VTEX) {
    const g = ctx.regiones[t]
    console.log(`${t}: región Riohacha ${g?.localizada ? `SÍ (regionId ${g.regionId}, sellers ${g.sellers.join(', ')})` : 'NO: se usará el precio nacional'}`)
  }
  console.log(`D1 automático: ${ctx.autoD1 ? 'sí' : 'no (queda manual)'}`)
  registrar(s, 'probarTiendas', 'info', 'Prueba de tiendas', { salida, regiones: ctx.regiones })
  return { salida, regiones: ctx.regiones, autoD1: ctx.autoD1 }
}

/** Ejecutar desde el editor: comprueba que el Sheet y UrlFetch funcionan. */
export function autoprueba() {
  const ss = abrirHoja()
  const nombre = '_autoprueba'
  const vieja = ss.getSheetByName(nombre)
  if (vieja) ss.deleteSheet(vieja)
  const hoja = ss.insertSheet(nombre)
  hoja.getRange(1, 1, 1, 2).setValues([['clave', 'valor']])
  hoja.getRange(2, 1, 1, 2).setValues([['a', "'=1+1"]])
  const leido = hoja.getRange(2, 2).getValue()
  ss.deleteSheet(hoja)
  const r = UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true })
  const ok = leido === '=1+1' && r.getResponseCode() === 204
  console.log(`${ok ? '✔' : '✘'} escritura/lectura: ${JSON.stringify(leido)} · UrlFetch: ${r.getResponseCode()}`)
  return ok
}

export function tareaDiaria() {
  return A.tareaDiaria(serviciosGas())
}

export function continuarPrecios() {
  return A.continuarPrecios(serviciosGas())
}

/** Si se edita a mano una fila en el Sheet, se marca para que la app la reciba en el próximo pull. */
export function onEdit(e: GoogleAppsScript.Events.SheetsOnEdit) {
  const hoja = e?.range?.getSheet()
  const nombre = hoja?.getName() as NombreTabla
  if (!hoja || !(TABLAS_SYNC as string[]).includes(nombre)) return
  const fila = e.range.getRow()
  const n = e.range.getNumRows()
  if (fila + n - 1 < 2) return
  const desde = Math.max(2, fila)
  const cuantas = fila + n - desde
  const enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(String)
  const ahora = isoBogota(Date.now())
  for (const col of ['_srv', 'updated_at']) {
    const i = enc.indexOf(col)
    if (i >= 0 && col in TABLAS[nombre].cols) hoja.getRange(desde, i + 1, cuantas, 1).setValues(Array.from({ length: cuantas }, () => [ahora]))
  }
}
