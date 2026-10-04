import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { claveProducto } from '../../../shared/src/importarLista.ts'
import { mismoEan } from '../../../shared/src/ean.ts'
import { esUnidadBase, precioPorUnidad } from '../../../shared/src/unidades.ts'
import { INFO_TIENDAS, esTiendaVtex, TIENDAS_VTEX, type TiendaVtex } from '../../../shared/src/tiendas.ts'
import { catalogoLegacy } from '../../../shared/src/vtex/adaptador.ts'
import { esLocal, parseRegiones, REFERENCIA } from '../../../shared/src/vtex/region.ts'
import { armarSegmento, segmentoDeSetCookie } from '../../../shared/src/vtex/segmento.ts'
import { ordenarCandidatos, type Opcion } from '../../../shared/src/vtex/ordenar.ts'
import { urlBusqueda, urlPorEan, urlPorSku, urlRegiones } from '../../../shared/src/vtex/urls.ts'
import type { Candidato } from '../../../shared/src/vtex/parse.ts'

type Region = 'RIOHACHA' | 'DEFAULT'
type Json = Record<string, unknown>
type Contexto = { region: Region; sellers: string[]; segmento: string | null; regionGuardada: Json | null }
type Item = { id: string; q: string; ean: string; unidad: 'g' | 'ml' | 'unidad'; marca: string }
type CandidatoRegional = Candidato & { region: Region }

const ORIGENES = new Set(['https://robinszuniga.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'])
const MAX_LOTE = 8
const CACHE_MS = 5 * 60_000
const MAX_CACHE_CATALOGO = 500
const cacheCatalogo = new Map<string, { hasta: number; valor: Candidato[] }>()
const cacheRegion = new Map<string, { hasta: number; contexto: Contexto }>()

function cabecerasCors(origen: string | null): HeadersInit {
  return {
    ...(origen && ORIGENES.has(origen) ? { 'Access-Control-Allow-Origin': origen, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  }
}

function respuesta(origen: string | null, status: number, ok: boolean, data: unknown, codigo?: string, mensaje?: string) {
  return new Response(JSON.stringify({ ok, data: ok ? data : null, error: ok ? null : { codigo, mensaje } }), {
    status,
    headers: { ...cabecerasCors(origen), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function texto(valor: unknown, max: number): string {
  return typeof valor === 'string' ? valor.trim().slice(0, max) : ''
}

function objeto(valor: unknown): Json {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Json : {}
}

function parseJson(valor: string): Json | null {
  try { return objeto(JSON.parse(valor)) } catch { return null }
}

function ubicacionDe(valor: unknown): { cp: string; lon: number; lat: number } {
  const u = objeto(valor)
  const lon = Number(u.lon)
  const lat = Number(u.lat)
  return {
    cp: texto(u.cp, 12) || '440001',
    lon: Number.isFinite(lon) && lon >= -180 && lon <= 180 ? lon : -72.907,
    lat: Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : 11.544,
  }
}

function recientes(region: Json | null): boolean {
  const fecha = typeof region?.fecha === 'string' ? Date.parse(region.fecha) : NaN
  return Number.isFinite(fecha) && Date.now() - fecha < 7 * 86400_000
}

async function leerConfig(usuario: SupabaseClient, claves: string[]) {
  const { data, error } = await usuario.from('config').select('clave,valor').in('clave', claves)
  if (error) throw new Error('No se pudo leer la configuración de tu cuenta.')
  return new Map((data ?? []).map((x: { clave: string; valor: string }) => [x.clave, x.valor]))
}

async function guardarConfig(usuario: SupabaseClient, clave: string, valor: string) {
  const { error } = await usuario.from('config').upsert({ clave, valor }, { onConflict: 'user_id,clave' })
  if (error) throw new Error('No se pudo guardar la región en tu cuenta.')
}

async function getTexto(url: string, cookie?: string | null, leerCuerpo = true) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    signal: AbortSignal.timeout(10_000),
  })
  const body = leerCuerpo ? await response.text() : ''
  if (!leerCuerpo) await response.body?.cancel()
  return { status: response.status, body, setCookie: response.headers.get('set-cookie') }
}

async function resolverContexto(tienda: TiendaVtex, usuario: SupabaseClient, uid: string, ubicacion: ReturnType<typeof ubicacionDe>): Promise<Contexto> {
  const key = `${tienda}:${uid}:${ubicacion.lat.toFixed(3)}:${ubicacion.lon.toFixed(3)}`
  const cached = cacheRegion.get(key)
  if (cached && cached.hasta > Date.now()) return cached.contexto

  const [home, ciudad, referencia] = await Promise.all([
    getTexto(INFO_TIENDAS[tienda].home!, null, false),
    getTexto(urlRegiones(tienda, { lon: ubicacion.lon, lat: ubicacion.lat })),
    getTexto(urlRegiones(tienda, REFERENCIA)),
  ])
  const segmento = segmentoDeSetCookie(home.setCookie)
  const regionCiudad = parseRegiones(ciudad.status, ciudad.body)
  const regionReferencia = parseRegiones(referencia.status, referencia.body)
  if (!regionCiudad) throw new Error(`No se pudo consultar la región de ${INFO_TIENDAS[tienda].nombre}.`)
  const localizada = esLocal(regionCiudad, regionReferencia)
  const guardada = {
    regionId: regionCiudad.regionId,
    channel: String(segmento?.channel ?? '1'),
    sellers: regionCiudad.sellers,
    localizada,
    fecha: new Date().toISOString(),
  }
  await guardarConfig(usuario, `region.${tienda}`, JSON.stringify(guardada))
  if (tienda === 'D1') await guardarConfig(usuario, 'tienda_auto.D1', localizada ? 'si' : 'no')
  const contexto: Contexto = {
    region: localizada && regionCiudad.regionId ? 'RIOHACHA' : 'DEFAULT',
    sellers: localizada ? regionCiudad.sellers : [],
    segmento: localizada && regionCiudad.regionId ? armarSegmento(regionCiudad.regionId, guardada.channel) : null,
    regionGuardada: guardada,
  }
  cacheRegion.set(key, { hasta: Date.now() + 6 * 3600_000, contexto })
  return contexto
}

async function contexto(tienda: TiendaVtex, usuario: SupabaseClient, uid: string, forzar = false): Promise<Contexto> {
  const cfg = await leerConfig(usuario, ['ubicacion', `region.${tienda}`])
  const ubicacion = ubicacionDe(parseJson(cfg.get('ubicacion') ?? '') ?? {})
  const key = `${tienda}:${uid}:${ubicacion.lat.toFixed(3)}:${ubicacion.lon.toFixed(3)}`
  const cached = cacheRegion.get(key)
  if (!forzar && cached && cached.hasta > Date.now()) return cached.contexto
  const guardada = parseJson(cfg.get(`region.${tienda}`) ?? '')
  if (!forzar && guardada && recientes(guardada)) {
    const localizada = guardada.localizada === true && typeof guardada.regionId === 'string'
    const c: Contexto = {
      region: localizada ? 'RIOHACHA' : 'DEFAULT',
      sellers: localizada && Array.isArray(guardada.sellers) ? guardada.sellers.filter((x): x is string => typeof x === 'string') : [],
      segmento: localizada ? armarSegmento(String(guardada.regionId), texto(guardada.channel, 8) || '1') : null,
      regionGuardada: guardada,
    }
    cacheRegion.set(key, { hasta: Date.now() + 6 * 3600_000, contexto: c })
    return c
  }
  const c = await resolverContexto(tienda, usuario, uid, ubicacion)
  cacheRegion.set(key, { hasta: Date.now() + 6 * 3600_000, contexto: c })
  return c
}

async function consultar(tienda: TiendaVtex, url: string, cookie: string | null, sellers: string[]): Promise<{ candidatos: Candidato[]; error?: string }> {
  const key = `${tienda}|${cookie ?? ''}|${url}`
  const cached = cacheCatalogo.get(key)
  if (cached && cached.hasta > Date.now()) return { candidatos: cached.valor }
  let motivo = 'sin respuesta'
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await getTexto(url, cookie)
      const parsed = catalogoLegacy.interpretar(tienda, r.status, r.body, sellers)
      if (parsed.tipo === 'ok') {
        const candidatos = parsed.candidatos.slice(0, 30)
        if (cacheCatalogo.size >= MAX_CACHE_CATALOGO) {
          for (const [oldKey, entry] of cacheCatalogo) {
            if (entry.hasta <= Date.now() || cacheCatalogo.size >= MAX_CACHE_CATALOGO) cacheCatalogo.delete(oldKey)
          }
        }
        cacheCatalogo.set(key, { hasta: Date.now() + CACHE_MS, valor: candidatos })
        return { candidatos }
      }
      motivo = parsed.motivo
      if (parsed.tipo === 'error') break
    } catch (e) {
      motivo = e instanceof Error && e.name === 'TimeoutError' ? 'tiempo de espera agotado' : 'tienda no disponible'
    }
    if (intento === 0) await new Promise((resolve) => setTimeout(resolve, 180))
  }
  return { candidatos: [], error: motivo }
}

function tiendasDe(valor: unknown, conTodas = false): TiendaVtex[] {
  if (conTodas && valor === '*') return [...TIENDAS_VTEX]
  return esTiendaVtex(valor) ? [valor] : []
}

async function buscarEnTienda(usuario: SupabaseClient, uid: string, p: Json) {
  const q = texto(p.q, 80)
  const ean = texto(p.ean, 32).replace(/\D/g, '')
  const sku = texto(p.sku, 32).replace(/[^\w-]/g, '')
  const tiendas = tiendasDe(p.tienda, true)
  if (!tiendas.length || (!q && !ean && !sku) || (p.tienda === '*' && !ean)) throw new Error('Búsqueda inválida.')
  const resultados = await Promise.all(tiendas.map(async (tienda) => {
    const ctx = await contexto(tienda, usuario, uid)
    const url = ean ? urlPorEan(tienda, ean) : sku ? urlPorSku(tienda, sku) : urlBusqueda(tienda, { ft: q })
    const r = await consultar(tienda, url, ctx.segmento ? `vtex_segment=${ctx.segmento}` : null, ctx.sellers)
    return { tienda, r, region: ctx.region }
  }))
  const candidatos: CandidatoRegional[] = []
  const errores: string[] = []
  for (const x of resultados) {
    if (x.r.error) errores.push(`${x.tienda}: ${x.r.error}`)
    for (const c of x.r.candidatos) candidatos.push({ ...c, region: x.region })
  }
  return { candidatos, errores }
}

function validarItems(valor: unknown): Item[] {
  if (!Array.isArray(valor) || !valor.length || valor.length > MAX_LOTE) throw new Error(`Envía entre 1 y ${MAX_LOTE} productos.`)
  return valor.map((v) => {
    const o = objeto(v)
    const item: Item = {
      id: texto(o.id, 64), q: texto(o.q, 80), ean: texto(o.ean, 32).replace(/\D/g, ''),
      unidad: o.unidad as Item['unidad'], marca: texto(o.marca, 40),
    }
    if (!item.id || (!item.q && !item.ean) || !esUnidadBase(item.unidad)) throw new Error('Cada producto debe tener id, nombre o EAN y unidad válida.')
    return item
  })
}

async function buscarVarios(usuario: SupabaseClient, uid: string, p: Json) {
  const items = validarItems(p.items)
  const tiendas = p.tiendas === undefined ? ['OLIMPICA', 'EXITO'] as TiendaVtex[] : p.tiendas
  if (!Array.isArray(tiendas) || !tiendas.length || tiendas.length > TIENDAS_VTEX.length || tiendas.some((t) => !esTiendaVtex(t))) {
    throw new Error('La lista de tiendas no es válida.')
  }
  const permitidas = [...new Set(tiendas)] as TiendaVtex[]
  const contextos = new Map<TiendaVtex, Contexto>()
  await Promise.all(permitidas.map(async (t) => contextos.set(t, await contexto(t, usuario, uid))))
  const yaDice = (it: Item) => {
    const palabras = new Set(claveProducto(it.q).split(' '))
    return claveProducto(it.marca).split(' ').every((w) => palabras.has(w))
  }
  const textoBusca = (it: Item) => it.marca && !yaDice(it) ? `${it.q} ${it.marca}` : it.q
  const trabajos = items.flatMap((it) => permitidas.map((t) => ({ it, t })))
  const encontrados = await Promise.all(trabajos.map(async ({ it, t }) => {
    const ctx = contextos.get(t)!
    const url = it.ean ? urlPorEan(t, it.ean) : urlBusqueda(t, { ft: textoBusca(it), hasta: 19 })
    const r = await consultar(t, url, ctx.segmento ? `vtex_segment=${ctx.segmento}` : null, ctx.sellers)
    return { it, t, r, ctx }
  }))
  const errores = [...new Set(encontrados.filter((x) => x.r.error).map((x) => `${x.t}: ${x.r.error}`))]
  const resultados = items.map((it) => {
    const porTienda: Partial<Record<TiendaVtex, Opcion<CandidatoRegional>[]>> = {}
    for (const t of permitidas) {
      const x = encontrados.find((v) => v.it.id === it.id && v.t === t)
      const cands = (x?.r.candidatos ?? []).map((c) => ({ ...c, region: x!.ctx.region })) as CandidatoRegional[]
      porTienda[t] = it.ean
        ? cands.filter((c) => mismoEan(c.ean, it.ean) && c.contenido?.unidad === it.unidad).slice(0, 1)
          .map((c) => ({ ...c, puntaje: 100, precioUnidad: precioPorUnidad(c.precio, c.contenido!.valor, it.unidad) ?? 0, seguro: c.precio != null && c.disponible }))
        : ordenarCandidatos(it.q, it.unidad, cands, 4, it.marca)
    }
    return { id: it.id, porTienda }
  })
  return { resultados, errores, marcas: true }
}

async function actualizarVinculadas(usuario: SupabaseClient, uid: string, p: Json) {
  if (!Array.isArray(p.presentaciones) || !p.presentaciones.length || p.presentaciones.length > MAX_LOTE) throw new Error(`Actualiza entre 1 y ${MAX_LOTE} presentaciones por tanda.`)
  const pres = p.presentaciones.map((v) => {
    const x = objeto(v)
    const tienda = esTiendaVtex(x.tienda) ? x.tienda : null
    const presentacion_id = texto(x.presentacion_id, 100)
    const sku = texto(x.sku_id, 32).replace(/[^\w-]/g, '')
    const ean = texto(x.ean, 32).replace(/\D/g, '')
    if (!tienda || !presentacion_id || (!sku && !ean)) throw new Error('Presentación de tienda inválida.')
    return { tienda, presentacion_id, sku, ean }
  })
  const resultados = await Promise.all(pres.map(async (p) => {
    const ctx = await contexto(p.tienda, usuario, uid)
    const url = p.sku ? urlPorSku(p.tienda, p.sku) : urlPorEan(p.tienda, p.ean)
    let r = await consultar(p.tienda, url, ctx.segmento ? `vtex_segment=${ctx.segmento}` : null, ctx.sellers)
    let c = r.candidatos.find((x) => p.sku && x.skuId === p.sku) ?? r.candidatos.find((x) => p.ean && x.ean === p.ean)
    if (!c && p.sku && p.ean) {
      r = await consultar(p.tienda, urlPorEan(p.tienda, p.ean), ctx.segmento ? `vtex_segment=${ctx.segmento}` : null, ctx.sellers)
      c = r.candidatos.find((x) => x.ean === p.ean)
    }
    return c ? {
      presentacion_id: p.presentacion_id, tienda: p.tienda, region: ctx.region,
      precio: c.precio, precio_lista: c.precioLista, disponible: c.disponible,
      ean: c.ean, sku_id: c.skuId, vtex_product_id: c.productId,
      fecha_observado: new Date().toISOString(),
    } : { presentacion_id: p.presentacion_id, tienda: p.tienda, error: r.error ?? 'producto no encontrado' }
  }))
  return { resultados }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') {
    if (origin && !ORIGENES.has(origin)) return new Response(null, { status: 403 })
    return new Response('ok', { headers: cabecerasCors(origin) })
  }
  if (req.method !== 'POST') return respuesta(origin, 405, false, null, 'metodo', 'Usa POST.')
  if (origin && !ORIGENES.has(origin)) return respuesta(origin, 403, false, null, 'origen', 'Origen no permitido.')

  const auth = req.headers.get('authorization')
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_ANON_KEY')
  if (!auth?.startsWith('Bearer ') || !url || !key) return respuesta(origin, 401, false, null, 'sesion', 'Inicia sesión para consultar precios.')

  const usuario = createClient(url, key, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: sesion, error: authError } = await usuario.auth.getUser()
  if (authError || !sesion.user) return respuesta(origin, 401, false, null, 'sesion', 'La sesión venció. Vuelve a iniciar sesión.')

  let p: Json
  try {
    const body = await req.text()
    if (new TextEncoder().encode(body).byteLength > 32_000) return respuesta(origin, 413, false, null, 'tamano', 'Solicitud demasiado grande.')
    p = objeto(JSON.parse(body))
  } catch {
    return respuesta(origin, 400, false, null, 'json', 'Solicitud inválida.')
  }
  const accion = texto(p.a, 32)
  const unidades = accion === 'buscarVarios'
    ? Math.max(1, Math.min(MAX_LOTE, Array.isArray(p.items) ? p.items.length : 1)) * (Array.isArray(p.tiendas) ? Math.min(3, p.tiendas.length) : 2)
      + 3 * (Array.isArray(p.tiendas) ? Math.min(3, p.tiendas.length) : 2)
    : accion === 'buscarEnTienda'
      ? (p.tienda === '*' ? 12 : 4)
      : accion === 'actualizarVinculadas'
        ? Math.max(1, Math.min(MAX_LOTE, Array.isArray(p.presentaciones) ? p.presentaciones.length : 1)) + 9
        : 3
  const { data: cuota, error: errorCuota } = await usuario.rpc('consumir_cuota_vtex', { p_unidades: unidades })
  if (errorCuota) return respuesta(origin, 503, false, null, 'cuota', 'No se pudo comprobar el límite de consultas. Inténtalo más tarde.')
  if (cuota !== true) return respuesta(origin, 429, false, null, 'rate_limit', 'Has consultado muchos precios. Espera un minuto y vuelve a intentarlo.')

  try {
    let data: unknown
    if (accion === 'buscarEnTienda') data = await buscarEnTienda(usuario, sesion.user.id, p)
    else if (accion === 'buscarVarios') data = await buscarVarios(usuario, sesion.user.id, p)
    else if (accion === 'probarRegion') {
      const tienda = esTiendaVtex(p.tienda) ? p.tienda : null
      if (!tienda) throw new Error('Tienda inválida.')
      const ctx = await contexto(tienda, usuario, sesion.user.id, true)
      data = { region: ctx.regionGuardada, autoD1: tienda === 'D1' && ctx.region === 'RIOHACHA' }
    } else if (accion === 'actualizarVinculadas') data = await actualizarVinculadas(usuario, sesion.user.id, p)
    else return respuesta(origin, 400, false, null, 'accion', 'Acción no disponible.')
    return respuesta(origin, 200, true, data)
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'Error consultando las tiendas.'
    return respuesta(origin, 400, false, null, 'solicitud', mensaje)
  }
})
