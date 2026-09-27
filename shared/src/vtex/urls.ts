import { INFO_TIENDAS, type TiendaVtex } from '../tiendas.ts'

/**
 * encodeURIComponent deja los espacios como %20 (nunca '+': el WAF de VTEX responde
 * 400 "Scripts are not allowed!"). Los ':' de fq se dejan tal cual, como los usa la tienda.
 */
export function codificar(v: string): string {
  return encodeURIComponent(v).replace(/%3A/gi, ':')
}

export function query(params: readonly (readonly [string, string | number])[]): string {
  return params.map(([k, v]) => `${k}=${codificar(String(v))}`).join('&')
}

export interface Busqueda {
  ft?: string
  fq?: string[]
  desde?: number
  hasta?: number
  sc?: string
}

export const MAX_POR_PAGINA = 50
export const MAX_RESULTADOS = 2500

export function urlBusqueda(tienda: TiendaVtex, b: Busqueda, base = INFO_TIENDAS[tienda].catalogo!): string {
  const desde = Math.max(0, b.desde ?? 0)
  const hasta = Math.min(b.hasta ?? desde + MAX_POR_PAGINA - 1, desde + MAX_POR_PAGINA - 1, MAX_RESULTADOS - 1)
  const ps: [string, string | number][] = []
  if (b.ft) ps.push(['ft', b.ft])
  for (const f of b.fq ?? []) ps.push(['fq', f])
  ps.push(['_from', desde], ['_to', hasta])
  if (b.sc) ps.push(['sc', b.sc])
  return `${base}/api/catalog_system/pub/products/search?${query(ps)}`
}

export function urlPorSku(tienda: TiendaVtex, sku: string, sc?: string): string {
  return urlBusqueda(tienda, { fq: [`skuId:${sku}`], sc })
}

export function urlPorEan(tienda: TiendaVtex, ean: string, sc?: string): string {
  return urlBusqueda(tienda, { fq: [`alternateIds_Ean:${ean}`], sc })
}

export function urlPorProducto(tienda: TiendaVtex, productId: string, sc?: string): string {
  return urlBusqueda(tienda, { fq: [`productId:${productId}`], sc })
}

export type Lugar = { cp: string } | { lon: number; lat: number }

export function urlRegiones(tienda: TiendaVtex, lugar: Lugar, sc?: string, base = INFO_TIENDAS[tienda].checkout!): string {
  const ps: [string, string][] = [['country', 'COL']]
  if ('cp' in lugar) ps.push(['postalCode', lugar.cp])
  else ps.push(['geoCoordinates', `${lugar.lon};${lugar.lat}`])
  if (sc) ps.push(['sc', sc])
  return `${base}/api/checkout/pub/regions?${query(ps)}`
}
