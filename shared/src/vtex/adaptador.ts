import type { TiendaVtex } from '../tiendas.ts'
import { candidatosDeProductos, clasificarRespuesta, type Candidato } from './parse.ts'
import { urlBusqueda, urlPorEan, urlPorSku } from './urls.ts'

export type Interpretacion =
  | { tipo: 'ok'; candidatos: Candidato[] }
  | { tipo: 'reintentar'; motivo: string }
  | { tipo: 'error'; motivo: string }

/**
 * Cómo se consulta el catálogo de una tienda. Hoy todas usan la API legacy de VTEX; si VTEX la retira,
 * se agrega otro adaptador (intelligent-search, GraphQL de Éxito) sin tocar el resto.
 */
export interface AdaptadorCatalogo {
  urlTexto(tienda: TiendaVtex, q: string, desde: number, sc?: string): string
  urlSku(tienda: TiendaVtex, sku: string, sc?: string): string
  urlEan(tienda: TiendaVtex, ean: string, sc?: string): string
  interpretar(tienda: TiendaVtex, status: number, cuerpo: string, sellersRegion: readonly string[]): Interpretacion
}

export const catalogoLegacy: AdaptadorCatalogo = {
  urlTexto: (tienda, q, desde, sc) => urlBusqueda(tienda, { ft: q, desde, sc }),
  urlSku: (tienda, sku, sc) => urlPorSku(tienda, sku, sc),
  urlEan: (tienda, ean, sc) => urlPorEan(tienda, ean, sc),
  interpretar(tienda, status, cuerpo, sellersRegion) {
    const c = clasificarRespuesta(status, cuerpo)
    if (c.tipo !== 'ok') return c
    return { tipo: 'ok', candidatos: candidatosDeProductos(tienda, c.productos, sellersRegion) }
  },
}
