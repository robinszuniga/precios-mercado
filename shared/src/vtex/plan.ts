import type { Observacion, Presentacion, Region } from '../esquema.ts'
import { esTiendaVtex, TIENDAS_VTEX, type TiendaVtex } from '../tiendas.ts'
import { catalogoLegacy, type AdaptadorCatalogo } from './adaptador.ts'
import type { Candidato } from './parse.ts'
import { cabeceraCookie } from './segmento.ts'

/** Cómo consultar cada tienda: con la cookie de Riohacha si la región está localizada, sin ella si no. */
export interface ContextoTienda {
  segmento: string | null
  sellers: string[]
  region: Region
  sc?: string
}

export type Contextos = Partial<Record<TiendaVtex, ContextoTienda>>

export interface Peticion {
  tienda: TiendaVtex
  presentacion_id: string
  tipo: 'sku' | 'ean'
  url: string
  cabeceras: Record<string, string>
  intento: number
}

export type Parche = Partial<Pick<Presentacion, 'sku_id' | 'vtex_product_id' | 'ultimo_error' | 'contenido'>>

export type Resultado =
  | { tipo: 'obs'; obs: Observacion; parche: Parche | null }
  | { tipo: 'respaldo'; peticion: Peticion }
  | { tipo: 'reintentar'; motivo: string }
  | { tipo: 'error'; motivo: string; parche: Parche | null }

function cabeceras(ctx: ContextoTienda | undefined): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' }
  if (ctx?.segmento) h.Cookie = cabeceraCookie(ctx.segmento)
  return h
}

export function peticionSku(p: Presentacion, ctx: ContextoTienda | undefined, a: AdaptadorCatalogo = catalogoLegacy): Peticion {
  const tienda = p.tienda as TiendaVtex
  return { tienda, presentacion_id: p.presentacion_id, tipo: 'sku', url: a.urlSku(tienda, p.sku_id, ctx?.sc), cabeceras: cabeceras(ctx), intento: 0 }
}

export function peticionEan(p: Presentacion, ctx: ContextoTienda | undefined, a: AdaptadorCatalogo = catalogoLegacy): Peticion {
  const tienda = p.tienda as TiendaVtex
  return { tienda, presentacion_id: p.presentacion_id, tipo: 'ean', url: a.urlEan(tienda, p.ean, ctx?.sc), cabeceras: cabeceras(ctx), intento: 0 }
}

/** Presentaciones que se actualizan solas. D1 solo si su región atiende Riohacha. */
export function presentacionesAuto(ps: readonly Presentacion[], autoD1: boolean): Presentacion[] {
  return ps.filter(
    (p) => p.activo && p.auto && esTiendaVtex(p.tienda) && (p.sku_id || p.ean) && (p.tienda !== 'D1' || autoD1),
  )
}

/** Peticiones alternando tiendas, para no cargar una sola seguido. */
export function planificarPeticiones(ps: readonly Presentacion[], ctx: Contextos, a: AdaptadorCatalogo = catalogoLegacy): Peticion[] {
  const colas = TIENDAS_VTEX.map((t) =>
    ps.filter((p) => p.tienda === t).map((p) => (p.sku_id ? peticionSku(p, ctx[t], a) : peticionEan(p, ctx[t], a))),
  )
  const salida: Peticion[] = []
  for (let i = 0; colas.some((c) => i < c.length); i++) for (const c of colas) if (i < c.length) salida.push(c[i])
  return salida
}

export function idObservacionAuto(presentacion_id: string, ahora: string): string {
  // Una por presentación y hora: el botón y el trigger del mismo rato no duplican el histórico.
  return `auto:${presentacion_id}:${ahora.slice(0, 13)}`
}

export function observacionAuto(p: Presentacion, c: Candidato, region: Region, ahora: string): Observacion {
  return {
    obs_id: idObservacionAuto(p.presentacion_id, ahora),
    presentacion_id: p.presentacion_id,
    tienda: p.tienda,
    origen: 'online',
    fuente: 'auto',
    precio: c.precio,
    precio_lista: c.precioLista,
    disponible: c.disponible,
    region,
    fecha_observado: ahora,
    compra_id: '',
  }
}

/** Qué hacer con la respuesta de una petición. */
export function procesarRespuesta(
  pet: Peticion,
  status: number,
  cuerpo: string,
  p: Presentacion,
  ctx: ContextoTienda | undefined,
  ahora: string,
  a: AdaptadorCatalogo = catalogoLegacy,
): Resultado {
  const r = a.interpretar(pet.tienda, status, cuerpo, ctx?.sellers ?? [])
  if (r.tipo === 'reintentar') return r
  if (r.tipo === 'error') return { tipo: 'error', motivo: r.motivo, parche: { ultimo_error: `${ahora.slice(0, 10)} ${r.motivo}` } }

  const c =
    pet.tipo === 'sku'
      ? r.candidatos.find((x) => x.skuId === p.sku_id)
      : r.candidatos.find((x) => x.ean === p.ean) ?? (r.candidatos.length === 1 ? r.candidatos[0] : undefined)
  if (!c) {
    if (pet.tipo === 'sku' && p.ean) return { tipo: 'respaldo', peticion: peticionEan(p, ctx, a) }
    return { tipo: 'error', motivo: 'producto no encontrado', parche: { ultimo_error: `${ahora.slice(0, 10)} no encontrado en la tienda` } }
  }
  const parche: Parche = {}
  if (c.skuId && c.skuId !== p.sku_id) parche.sku_id = c.skuId
  if (c.productId && c.productId !== p.vtex_product_id) parche.vtex_product_id = c.productId
  if (p.ultimo_error) parche.ultimo_error = ''
  return { tipo: 'obs', obs: observacionAuto(p, c, ctx?.region ?? 'DEFAULT', ahora), parche: Object.keys(parche).length ? parche : null }
}
