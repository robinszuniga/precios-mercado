// Prueba real de las APIs VTEX de Éxito, Olímpica y D1 desde donde se corra (máquina local, CI o el
// entorno de Claude). Decide por tienda: automático con región de Riohacha, automático nacional o manual.
//
//   node tools/smoke-vtex.ts             → tabla de resultados
//   node tools/smoke-vtex.ts --fixtures  → además guarda las respuestas en shared/test/fixtures/vtex/
//   node tools/smoke-vtex.ts --tienda EXITO --q "arroz diana"
import { mkdirSync, writeFileSync } from 'node:fs'
import { candidatosDeProductos, clasificarRespuesta, type Candidato } from '../shared/src/vtex/parse.ts'
import { estaLocalizada, parseRegiones, type RegionVtex } from '../shared/src/vtex/region.ts'
import { armarSegmento, cabeceraCookie, segmentoDeSetCookie, type Segmento } from '../shared/src/vtex/segmento.ts'
import { urlBusqueda, urlPorEan, urlPorProducto, urlPorSku, urlRegiones, type Lugar } from '../shared/src/vtex/urls.ts'
import { INFO_TIENDAS, TIENDAS_VTEX, type TiendaVtex } from '../shared/src/tiendas.ts'

const args = process.argv.slice(2)
const GUARDAR = args.includes('--fixtures')
const SOLO = args.includes('--tienda') ? (args[args.indexOf('--tienda') + 1] as TiendaVtex) : null
const Q = args.includes('--q') ? args[args.indexOf('--q') + 1] : 'arroz diana'
const DIR = new URL('../shared/test/fixtures/vtex/', import.meta.url)

const RIOHACHA: { cp: Lugar; geo: Lugar } = { cp: { cp: '440001' }, geo: { lon: -72.907, lat: 11.544 } }
const BOGOTA: { cp: Lugar; geo: Lugar } = { cp: { cp: '110111' }, geo: { lon: -74.0721, lat: 4.711 } }

interface Resp { status: number; cuerpo: string; ms: number; url: string; redirigido: boolean; cabeceras: Headers }

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function pedir(url: string, cookie?: string): Promise<Resp> {
  const t = Date.now()
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'precios-mercado-smoke/1', ...(cookie ? { Cookie: cookie } : {}) },
      signal: AbortSignal.timeout(20000),
    })
    const cuerpo = await res.text()
    return { status: res.status, cuerpo, ms: Date.now() - t, url: res.url, redirigido: res.redirected, cabeceras: res.headers }
  } catch (e) {
    return { status: 0, cuerpo: String(e), ms: Date.now() - t, url, redirigido: false, cabeceras: new Headers() }
  }
}

function guardar(nombre: string, r: Resp, recortar = 3) {
  if (!GUARDAR) return
  mkdirSync(DIR, { recursive: true })
  let cuerpo: unknown = r.cuerpo
  try {
    const v = JSON.parse(r.cuerpo)
    cuerpo = Array.isArray(v) ? v.slice(0, recortar) : v
  } catch { cuerpo = r.cuerpo.slice(0, 2000) }
  const archivo = new URL(`${nombre}.json`, DIR)
  writeFileSync(archivo, JSON.stringify({ status: r.status, resources: r.cabeceras.get('resources'), url: r.url, cuerpo }, null, 2))
}

function candidatos(tienda: TiendaVtex, r: Resp, sellers: string[] = []): Candidato[] {
  const c = clasificarRespuesta(r.status, r.cuerpo)
  return c.tipo === 'ok' ? candidatosDeProductos(tienda, c.productos, sellers) : []
}

function linea(ok: boolean | null, texto: string) {
  console.log(`  ${ok === null ? '·' : ok ? '✔' : '✘'} ${texto}`)
}

async function region(tienda: TiendaVtex, lugar: { cp: Lugar; geo: Lugar }, sc?: string): Promise<{ r: RegionVtex | null; via: string; resp: Resp }> {
  const porCp = await pedir(urlRegiones(tienda, lugar.cp, sc))
  const r1 = parseRegiones(porCp.status, porCp.cuerpo)
  if (estaLocalizada(r1)) return { r: r1, via: 'cp', resp: porCp }
  await espera(800)
  const porGeo = await pedir(urlRegiones(tienda, lugar.geo, sc))
  const r2 = parseRegiones(porGeo.status, porGeo.cuerpo)
  return { r: estaLocalizada(r2) ? r2 : (r2 ?? r1), via: estaLocalizada(r2) ? 'geo' : 'ninguna', resp: porGeo }
}

function legible(regionId: string | null): string {
  if (!regionId) return '—'
  if (regionId.startsWith('v2.')) return regionId
  try { return Buffer.from(regionId, 'base64').toString('utf8') } catch { return regionId }
}

/** Para entender la regionalización: qué región sale por CP y por coordenadas, y qué sellers y precios trae el SKU con cada cookie. */
async function diagnosticoRegiones(tienda: TiendaVtex, sku: string, channel: string, segBase: Segmento | null, home: Resp) {
  console.log(`  -- diagnóstico de regiones (${tienda}) --`)
  const nombresCookies = (home.cabeceras.getSetCookie?.() ?? []).map((c) => c.split('=')[0])
  console.log(`     cookies de la home: ${nombresCookies.join(', ') || '(ninguna)'}`)
  const lugares: [string, Lugar][] = [
    ['Riohacha CP', { cp: '440001' }],
    ['Riohacha geo', { lon: -72.907, lat: 11.544 }],
    ['Bogotá CP', { cp: '110111' }],
    ['Bogotá geo', { lon: -74.0721, lat: 4.711 }],
    ['Medellín geo', { lon: -75.5636, lat: 6.2518 }],
    ['Barranquilla geo', { lon: -74.7813, lat: 10.9685 }],
  ]
  const vistos = new Map<string, string>()
  for (const [nombre, lugar] of lugares) {
    await espera(500)
    const r = await pedir(urlRegiones(tienda, lugar))
    const reg = parseRegiones(r.status, r.cuerpo)
    console.log(`     ${nombre}: HTTP ${r.status} región=${legible(reg?.regionId ?? null)} sellers=${reg?.sellers.join(',') || '—'}`)
    if (reg?.regionId && !vistos.has(reg.regionId)) vistos.set(reg.regionId, nombre)
  }
  const variantes: [string, string | undefined][] = [['sin cookie', undefined]]
  for (const [id, nombre] of vistos) variantes.push([`cookie ${nombre}`, cabeceraCookie(armarSegmento(id, channel, segBase))])
  for (const [nombre, cookie] of variantes) {
    await espera(500)
    const r = await pedir(urlPorSku(tienda, sku), cookie)
    let sellers = '—'
    try {
      const item = (JSON.parse(r.cuerpo) as { items: { itemId: string; sellers: { sellerId: string; sellerDefault: boolean; commertialOffer: { Price: number; ListPrice: number; AvailableQuantity: number } }[] }[] }[])[0]?.items.find((i) => i.itemId === sku)
      sellers = item?.sellers.map((s) => `${s.sellerId}${s.sellerDefault ? '*' : ''}=${s.commertialOffer.Price}/${s.commertialOffer.ListPrice} (${s.commertialOffer.AvailableQuantity})`).join(' · ') ?? 'SKU no está'
    } catch { sellers = `no JSON: ${r.cuerpo.slice(0, 80)}` }
    console.log(`     SKU ${sku} ${nombre}: HTTP ${r.status} → ${sellers}`)
  }
}

async function probar(tienda: TiendaVtex) {
  console.log(`\n=== ${INFO_TIENDAS[tienda].nombre} (${INFO_TIENDAS[tienda].catalogo}) ===`)
  const resumen: Record<string, unknown> = { tienda }

  const busq = await pedir(urlBusqueda(tienda, { ft: Q }))
  guardar(`${tienda.toLowerCase()}-busqueda`, busq)
  const cands = candidatos(tienda, busq)
  const okBusq = cands.length > 0
  linea(okBusq, `ft="${Q}": HTTP ${busq.status} en ${busq.ms} ms, ${cands.length} SKUs, resources=${busq.cabeceras.get('resources')}${busq.redirigido ? `, redirigido a ${busq.url}` : ''}`)
  if (!okBusq) {
    linea(false, `respuesta: ${busq.cuerpo.slice(0, 200).replace(/\s+/g, ' ')}`)
    resumen.decision = busq.status === 403 || busq.status === 0 ? 'BLOQUEADO desde aquí' : 'REVISAR'
    return resumen
  }
  const c = cands.find((x) => x.precio && x.ean) ?? cands[0]
  linea(null, `muestra: "${c.nombre}" sku=${c.skuId} ean=${c.ean} productId=${c.productId} precio=${c.precio} lista=${c.precioLista} contenido=${JSON.stringify(c.contenido)}`)

  const mas = await pedir(urlBusqueda(tienda, { ft: Q }).replace(/%20/g, '+'))
  linea(null, `con "+" en vez de %20: HTTP ${mas.status} ${/scripts are not allowed/i.test(mas.cuerpo) ? '(WAF "Scripts are not allowed")' : ''}`)

  const pag = await pedir(urlBusqueda(tienda, { ft: 'arroz', desde: 50 }))
  linea(pag.status === 200 || pag.status === 206, `página 2 (_from=50): HTTP ${pag.status}, resources=${pag.cabeceras.get('resources')}`)

  for (const [nombre, url] of [
    ['skuId', urlPorSku(tienda, c.skuId)],
    ['productId', urlPorProducto(tienda, c.productId)],
    ['EAN', c.ean ? urlPorEan(tienda, c.ean) : ''],
  ] as const) {
    if (!url) { linea(null, `fq=${nombre}: sin dato`); continue }
    await espera(600)
    const r = await pedir(url)
    const encontrado = candidatos(tienda, r).some((x) => x.skuId === c.skuId)
    linea(encontrado, `fq=${nombre}: HTTP ${r.status}, ${encontrado ? 'devuelve el mismo SKU' : 'NO devuelve el SKU'}`)
    if (nombre === 'skuId') guardar(`${tienda.toLowerCase()}-sku`, r)
  }

  const otro = cands.find((x) => x.skuId !== c.skuId)
  if (otro) {
    const r = await pedir(urlBusqueda(tienda, { fq: [`skuId:${c.skuId}`, `skuId:${otro.skuId}`] }))
    linea(null, `dos fq=skuId juntos: ${candidatos(tienda, r).length} SKUs (2 = se combinan como O; 0 = como Y)`)
  }

  const home = await pedir(INFO_TIENDAS[tienda].home!)
  const segBase: Segmento | null = segmentoDeSetCookie(home.cabeceras.getSetCookie?.() ?? [])
  const channel = String(segBase?.channel ?? '1')
  linea(!!segBase, `home: HTTP ${home.status}, vtex_segment ${segBase ? `channel=${channel} regionId=${segBase.regionId ?? '—'}` : 'no llegó'}`)

  const rio = await region(tienda, RIOHACHA)
  guardar(`${tienda.toLowerCase()}-regiones-riohacha`, rio.resp)
  const localizada = estaLocalizada(rio.r)
  linea(localizada, `región Riohacha: ${localizada ? `regionId=${rio.r!.regionId} sellers=${rio.r!.sellers.join(',')} (vía ${rio.via})` : `sin sellers (HTTP ${rio.resp.status}: ${rio.resp.cuerpo.slice(0, 120)})`}`)
  const bog = await region(tienda, BOGOTA)
  linea(estaLocalizada(bog.r), `región Bogotá: ${estaLocalizada(bog.r) ? `regionId=${bog.r!.regionId} sellers=${bog.r!.sellers.join(',')}` : 'sin sellers'}`)

  const precioCon = async (reg: RegionVtex | null) => {
    const cookie = reg?.regionId ? cabeceraCookie(armarSegmento(reg.regionId, channel, segBase)) : undefined
    const r = await pedir(urlPorSku(tienda, c.skuId), cookie)
    return candidatos(tienda, r, reg?.sellers ?? []).find((x) => x.skuId === c.skuId)
  }
  const sin = await precioCon(null)
  const conRio = localizada ? await precioCon(rio.r) : undefined
  const conBog = estaLocalizada(bog.r) ? await precioCon(bog.r) : undefined
  linea(null, `precio del SKU ${c.skuId}: sin cookie=${sin?.precio ?? '—'} · Riohacha=${conRio?.precio ?? '—'} (seller ${conRio?.sellerId ?? '—'}) · Bogotá=${conBog?.precio ?? '—'} (seller ${conBog?.sellerId ?? '—'})`)

  await diagnosticoRegiones(tienda, c.skuId, channel, segBase, home)

  let n429 = 0
  for (let i = 0; i < 10; i++) {
    const r = await pedir(urlPorSku(tienda, c.skuId))
    if (r.status === 429) n429++
    await espera(1000)
  }
  linea(n429 === 0, `10 llamadas a 1 s: ${n429} respuestas 429`)

  resumen.decision = localizada ? 'AUTO con región de Riohacha' : tienda === 'D1' ? 'MANUAL (no atiende Riohacha)' : 'AUTO nacional (distintivo online·nac)'
  resumen.regionId = rio.r?.regionId ?? null
  resumen.sellers = rio.r?.sellers ?? []
  resumen.channel = channel
  resumen.precios = { sinCookie: sin?.precio ?? null, riohacha: conRio?.precio ?? null, bogota: conBog?.precio ?? null }
  return resumen
}

const resultados = []
for (const t of TIENDAS_VTEX) {
  if (SOLO && t !== SOLO) continue
  resultados.push(await probar(t))
}
console.log('\n=== Decisión por tienda ===')
console.table(resultados.map((r) => ({ tienda: r.tienda, decision: r.decision, regionId: r.regionId ?? '', sellers: String(r.sellers ?? '') })))
if (GUARDAR) console.log(`Fixtures guardadas en ${DIR.pathname}`)
