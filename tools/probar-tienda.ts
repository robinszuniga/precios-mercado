// Averigua si la tienda en línea de un supermercado (VTEX) muestra precios de Riohacha o solo precios nacionales.
// Sirve para cualquier tienda que use VTEX sin agregarla a la app. No escribe nada: solo hace consultas públicas.
//
//   node tools/probar-tienda.ts https://www.jumbocolombia.com            (la tienda en línea de Jumbo, que usa Metro)
//   node tools/probar-tienda.ts https://www.d1.com.co --q "arroz"
//
// Pregunta lo mismo que la app para Éxito, Olímpica y D1: ¿la región de Riohacha trae algún vendedor (seller) propio, que no
// aparezca también en Bogotá? Si sí, el precio en línea es el de Riohacha; si solo hay vendedores genéricos, es el nacional.
import { esLocal, estaLocalizada, parseRegiones, type RegionVtex } from '../shared/src/vtex/region.ts'
import { armarSegmento, cabeceraCookie, segmentoDeSetCookie, type Segmento } from '../shared/src/vtex/segmento.ts'

const args = process.argv.slice(2)
const BASE = (args.find((a) => /^https?:\/\//.test(a)) ?? '').replace(/\/+$/, '')
const Q = args.includes('--q') ? args[args.indexOf('--q') + 1] : 'arroz'
if (!BASE) {
  console.error('Uso: node tools/probar-tienda.ts https://www.tienda.com.co [--q "arroz"]')
  process.exit(1)
}

const RIOHACHA = { lon: -72.907, lat: 11.544 }
const BOGOTA = { lon: -74.0721, lat: 4.711 } // ciudad de referencia para descartar vendedores genéricos

interface Resp { status: number; cuerpo: string; ms: number; cabeceras: Headers }

async function pedir(url: string, cookie?: string): Promise<Resp> {
  const t = Date.now()
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'precios-mercado-probar-tienda/1', ...(cookie ? { Cookie: cookie } : {}) },
      signal: AbortSignal.timeout(20000),
    })
    return { status: res.status, cuerpo: await res.text(), ms: Date.now() - t, cabeceras: res.headers }
  } catch (e) {
    return { status: 0, cuerpo: String(e), ms: Date.now() - t, cabeceras: new Headers() }
  }
}

const linea = (ok: boolean | null, texto: string) => console.log(`  ${ok === null ? '·' : ok ? '✔' : '✘'} ${texto}`)
const url = (base: string, ruta: string, ps: [string, string][]) => `${base}${ruta}?${ps.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`

interface OfertaSeller { sellerId: string; predeterminado: boolean; precio: number; lista: number; disponible: number }
interface Producto { nombre: string; sku: string; ean: string; ofertas: OfertaSeller[] }

/** Lee la respuesta de products/search (formato VTEX). */
function productos(cuerpo: string): Producto[] {
  let datos: unknown
  try { datos = JSON.parse(cuerpo) } catch { return [] }
  if (!Array.isArray(datos)) return []
  const salida: Producto[] = []
  for (const p of datos as Record<string, unknown>[]) {
    for (const it of (p.items as Record<string, unknown>[] | undefined) ?? []) {
      const ofertas = ((it.sellers as Record<string, unknown>[] | undefined) ?? []).map((s) => {
        const o = (s.commertialOffer ?? {}) as Record<string, unknown>
        return {
          sellerId: String(s.sellerId ?? ''),
          predeterminado: s.sellerDefault === true,
          precio: Number(o.Price ?? 0),
          lista: Number(o.ListPrice ?? 0),
          disponible: Number(o.AvailableQuantity ?? 0),
        }
      })
      salida.push({ nombre: String(p.productName ?? ''), sku: String(it.itemId ?? ''), ean: String(it.ean ?? ''), ofertas })
    }
  }
  return salida
}

const conPrecio = (p: Producto) => p.ofertas.some((o) => o.precio > 0 && o.disponible > 0)
const verOfertas = (o: OfertaSeller[]) => o.map((x) => `${x.sellerId}${x.predeterminado ? '*' : ''}=$${x.precio}${x.disponible > 0 ? '' : ' (agotado)'}`).join(' · ') || '—'

async function regionDe(base: string, lugar: { lon: number; lat: number }): Promise<{ r: RegionVtex | null; resp: Resp }> {
  const resp = await pedir(url(base, '/api/checkout/pub/regions', [['country', 'COL'], ['geoCoordinates', `${lugar.lon};${lugar.lat}`]]))
  return { r: parseRegiones(resp.status, resp.cuerpo), resp }
}

console.log(`\n=== ${BASE} ===`)
const veredicto: string[] = []

// 1. ¿Responde como una tienda VTEX? Algunas (como Éxito) sirven el catálogo bajo /io.
let base = BASE
let busqueda = await pedir(url(base, '/api/catalog_system/pub/products/search', [['ft', Q], ['_from', '0'], ['_to', '9']]))
let lista = productos(busqueda.cuerpo)
if (!lista.length) {
  const alterna = `${BASE}/io`
  const otra = await pedir(url(alterna, '/api/catalog_system/pub/products/search', [['ft', Q], ['_from', '0'], ['_to', '9']]))
  if (productos(otra.cuerpo).length) { base = alterna; busqueda = otra; lista = productos(otra.cuerpo) }
}
linea(lista.length > 0, `búsqueda "${Q}": HTTP ${busqueda.status} en ${busqueda.ms} ms, ${lista.length} productos${base !== BASE ? ` (catálogo bajo ${base})` : ''}`)
if (!lista.length) {
  linea(false, `respuesta: ${busqueda.cuerpo.slice(0, 200).replace(/\s+/g, ' ')}`)
  const causa = busqueda.status === 0 || busqueda.status === 403 ? 'Esta conexión no pudo llegar a la tienda (¿sin internet, o bloqueada?).' : 'La tienda no responde como VTEX: no se puede consultar con este método.'
  veredicto.push(`NO SE PUDO COMPROBAR. ${causa}`)
} else {
  const muestra = lista.find((p) => conPrecio(p) && p.ean) ?? lista.find(conPrecio) ?? lista[0]
  linea(null, `muestra: "${muestra.nombre}" sku=${muestra.sku} ean=${muestra.ean || '—'}`)
  linea(null, `vendedores y precios (sin elegir ciudad): ${verOfertas(muestra.ofertas)}`)

  // 2. ¿Qué región da la tienda para Riohacha y para Bogotá?
  const home = await pedir(`${BASE}/`)
  const segBase: Segmento | null = segmentoDeSetCookie(home.cabeceras.getSetCookie?.() ?? [])
  const canal = String(segBase?.channel ?? '1')
  const rio = await regionDe(base, RIOHACHA)
  const bog = await regionDe(base, BOGOTA)
  linea(null, `región de Riohacha: id=${rio.r?.regionId ?? '—'} vendedores=${rio.r?.sellers.join(',') || '—'} (HTTP ${rio.resp.status})`)
  linea(null, `región de Bogotá:   id=${bog.r?.regionId ?? '—'} vendedores=${bog.r?.sellers.join(',') || '—'} (HTTP ${bog.resp.status})`)

  // 3. El precio de ese mismo producto, pidiéndolo como si se estuviera en cada ciudad.
  const precioEn = async (reg: RegionVtex | null) => {
    if (!reg?.regionId) return null
    const cookie = cabeceraCookie(armarSegmento(reg.regionId, canal, segBase))
    const r = await pedir(url(base, '/api/catalog_system/pub/products/search', [['fq', `skuId:${muestra.sku}`]]), cookie)
    return productos(r.cuerpo).find((p) => p.sku === muestra.sku)?.ofertas ?? null
  }
  const enRio = await precioEn(rio.r)
  const enBog = await precioEn(bog.r)
  if (enRio) linea(null, `con Riohacha: ${verOfertas(enRio)}`)
  if (enBog) linea(null, `con Bogotá:   ${verOfertas(enBog)}`)

  // 4. Veredicto.
  const propios = (rio.r?.sellers ?? []).filter((s) => !(bog.r?.sellers ?? []).includes(s))
  if (esLocal(rio.r, bog.r)) {
    veredicto.push(`SÍ atiende Riohacha: tiene vendedor propio (${propios.join(', ')}). Los precios en línea son de Riohacha. Vale la pena agregarla a la app.`)
  } else if (estaLocalizada(rio.r)) {
    veredicto.push('PRECIO NACIONAL: Riohacha solo trae los mismos vendedores genéricos que Bogotá. Los precios en línea no son los de la tienda de Riohacha.')
  } else {
    veredicto.push('PRECIO NACIONAL: la tienda no tiene región para Riohacha (no regionaliza). Los precios en línea son iguales en todo el país.')
  }
  const rioMin = enRio?.filter((o) => o.precio > 0 && o.disponible > 0).map((o) => o.precio) ?? []
  const bogMin = enBog?.filter((o) => o.precio > 0 && o.disponible > 0).map((o) => o.precio) ?? []
  if (rioMin.length && bogMin.length) {
    veredicto.push(Math.min(...rioMin) === Math.min(...bogMin) ? 'El producto de muestra cuesta lo mismo con Riohacha que con Bogotá.' : 'El producto de muestra cuesta distinto con Riohacha que con Bogotá (la tienda sí ajusta el precio por ciudad).')
  }
}

console.log('\n=== RESUMEN (pégalo en el chat) ===')
console.log(`tienda: ${BASE}`)
for (const v of veredicto) console.log(`- ${v}`)
