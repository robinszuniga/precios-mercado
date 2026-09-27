import { parseContenido, type Contenido } from '../contenido.ts'
import type { TiendaVtex } from '../tiendas.ts'
import type { UnidadBase } from '../unidades.ts'

export type Clasificacion =
  | { tipo: 'ok'; productos: unknown[] }
  | { tipo: 'reintentar'; motivo: string }
  | { tipo: 'error'; motivo: string }

/**
 * 200 y 206 (contenido parcial, normal en VTEX) son válidos solo si el cuerpo es un array JSON.
 * 429, 5xx, sin respuesta o HTML con 200 se reintentan. 400 "Scripts are not allowed" es un bug de
 * codificación de la URL: no se reintenta. 403 suele ser bloqueo de IP.
 */
export function clasificarRespuesta(status: number, cuerpo: string): Clasificacion {
  const inicio = cuerpo.trimStart()
  if (status === 200 || status === 206) {
    if (!inicio.startsWith('[')) return { tipo: 'reintentar', motivo: `cuerpo no es JSON (${inicio.slice(0, 40)})` }
    try {
      const v = JSON.parse(inicio)
      return Array.isArray(v) ? { tipo: 'ok', productos: v } : { tipo: 'reintentar', motivo: 'JSON no es un array' }
    } catch {
      return { tipo: 'reintentar', motivo: 'JSON inválido' }
    }
  }
  if (status === 400 && /scripts are not allowed/i.test(cuerpo)) return { tipo: 'error', motivo: 'waf: la URL lleva caracteres que VTEX rechaza' }
  if (status === 403) return { tipo: 'error', motivo: 'bloqueado (403)' }
  if (status === 0 || status === 429 || status >= 500) return { tipo: 'reintentar', motivo: `HTTP ${status}` }
  return { tipo: 'error', motivo: `HTTP ${status}` }
}

export interface ContenidoDetectado {
  valor: number
  unidad: UnidadBase
  fuente: 'nombre' | 'pum' | 'medida'
  confianza: Contenido['confianza']
}

export interface Candidato {
  tienda: TiendaVtex
  productId: string
  skuId: string
  ean: string
  nombre: string
  marca: string
  url: string
  sellerId: string
  /** null si no hay precio válido (≤ 0). */
  precio: number | null
  precioLista: number | null
  disponible: boolean
  oferta: boolean
  contenido: ContenidoDetectado | null
}

type Json = Record<string, unknown>

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function primero(v: unknown): string {
  return Array.isArray(v) ? str(v[0]) : str(v)
}

/** Especificaciones PUM de Éxito/Olímpica ("Factor Neto PUM", "Unidad de Medida PUM Calculado"). */
function contenidoPum(p: Json): ContenidoDetectado | null {
  let factor: number | null = null
  let unidad = ''
  for (const [k, v] of Object.entries(p)) {
    const kn = k.toLowerCase()
    if (!kn.includes('pum')) continue
    if (kn.includes('factor') || kn.includes('neto')) factor = Number(primero(v).replace(',', '.')) || null
    else if (kn.includes('unidad')) unidad = primero(v).toLowerCase()
  }
  if (!factor || !unidad) return null
  const u = unidad.normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (/^(kg|kilo)/.test(u)) return { valor: factor * 1000, unidad: 'g', fuente: 'pum', confianza: 'media' }
  if (/^(g|gr|gramo)/.test(u)) return { valor: factor, unidad: 'g', fuente: 'pum', confianza: 'media' }
  if (/^(ml|mililitro|cc)/.test(u)) return { valor: factor, unidad: 'ml', fuente: 'pum', confianza: 'media' }
  if (/^(l|lt|litro)/.test(u)) return { valor: factor * 1000, unidad: 'ml', fuente: 'pum', confianza: 'media' }
  if (/^(u|und|unid)/.test(u)) return { valor: factor, unidad: 'unidad', fuente: 'pum', confianza: 'media' }
  return null
}

/** measurementUnit × unitMultiplier: útil para frutas y granel ("kg" × 0.5 = se vende por 500 g). */
function contenidoMedida(item: Json): ContenidoDetectado | null {
  const u = str(item.measurementUnit).toLowerCase()
  const mult = numero(item.unitMultiplier) ?? 1
  if (!(mult > 0)) return null
  if (u === 'kg') return { valor: mult * 1000, unidad: 'g', fuente: 'medida', confianza: 'media' }
  if (u === 'g') return { valor: mult, unidad: 'g', fuente: 'medida', confianza: 'media' }
  if (u === 'l' || u === 'lt') return { valor: mult * 1000, unidad: 'ml', fuente: 'medida', confianza: 'media' }
  if (u === 'ml') return { valor: mult, unidad: 'ml', fuente: 'medida', confianza: 'media' }
  return null
}

/**
 * La oferta que vale: primero un seller de la región de Riohacha; si no, el seller por defecto;
 * si no, el "1" (la propia tienda). Los vendedores del marketplace se ignoran.
 */
function elegirOferta(item: Json, sellersRegion: readonly string[]): { sellerId: string; oferta: Json } | null {
  const sellers = arr(item.sellers).map(obj)
  const s =
    sellers.find((x) => sellersRegion.includes(str(x.sellerId))) ??
    sellers.find((x) => x.sellerDefault === true) ??
    sellers.find((x) => str(x.sellerId) === '1')
  return s ? { sellerId: str(s.sellerId), oferta: obj(s.commertialOffer) } : null
}

function aCandidato(tienda: TiendaVtex, p: Json, item: Json, sellersRegion: readonly string[]): Candidato | null {
  const elegida = elegirOferta(item, sellersRegion)
  if (!elegida) return null
  const { oferta } = elegida
  const precioBruto = numero(oferta.Price)
  const precio = precioBruto != null && precioBruto > 0 ? precioBruto : null
  const lista = numero(oferta.ListPrice)
  const precioLista = lista != null && lista > 0 ? lista : null
  const cantidad = numero(oferta.AvailableQuantity)
  const disponible = precio != null && oferta.IsAvailable !== false && (cantidad == null || cantidad > 0)
  const nombreItem = str(item.nameComplete) || str(item.name)
  const nombre = str(p.productName) || nombreItem
  const deNombre = parseContenido(nombreItem && nombreItem !== nombre ? `${nombre} ${nombreItem}` : nombre)
  const contenido: ContenidoDetectado | null = deNombre
    ? { ...deNombre, fuente: 'nombre' }
    : (contenidoPum(p) ?? contenidoMedida(item))
  const linkText = str(p.linkText)
  return {
    tienda,
    productId: str(p.productId),
    skuId: str(item.itemId),
    ean: str(item.ean),
    nombre,
    marca: str(p.brand),
    url: str(p.link) || (linkText ? `/${linkText}/p` : ''),
    sellerId: elegida.sellerId,
    precio,
    precioLista,
    disponible,
    oferta: precio != null && precioLista != null && precio < precioLista,
    contenido,
  }
}

/** Convierte la respuesta de products/search en candidatos (uno por SKU). */
export function candidatosDeProductos(tienda: TiendaVtex, productos: readonly unknown[], sellersRegion: readonly string[] = []): Candidato[] {
  const salida: Candidato[] = []
  for (const pv of productos) {
    const p = obj(pv)
    for (const iv of arr(p.items)) {
      const c = aCandidato(tienda, p, obj(iv), sellersRegion)
      if (c) salida.push(c)
    }
  }
  return salida
}
