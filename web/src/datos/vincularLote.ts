import type { Presentacion, Producto, Region } from '@shared/esquema.ts'
import type { TiendaVtex } from '@shared/tiendas.ts'
import type { UnidadBase } from '@shared/unidades.ts'
import type { Opcion } from '@shared/vtex/ordenar.ts'
import type { Candidato } from '@shared/vtex/parse.ts'
import { llamar } from './api.ts'
import { db, guardarMeta, leerMeta } from './db.ts'
import { guardar, nuevaPresentacion, observacion, registrarObservaciones } from './escritura.ts'
import { conexion } from './sync.ts'

export type Cand = Candidato & { region: Region }
export type OpcionLote = Opcion<Cand>
type PorTienda = Partial<Record<TiendaVtex, OpcionLote[]>>

/** Las tiendas que publican precio online útil para Riohacha (D1 no atiende Riohacha; Ara no vende online). */
export const TIENDAS_LOTE: TiendaVtex[] = ['OLIMPICA', 'EXITO']
const LOTE = 8
const HORAS_ENTRE_AUTOMATICOS = 20
const DIAS_SIN_REPETIR = 7

/** Crea la presentación de la tienda para el producto y guarda el precio que trajo la búsqueda. */
export async function crearDesdeCandidato(producto: Producto, c: Cand, contenido: number | null): Promise<Presentacion> {
  const [p] = await guardar<Presentacion>('Presentaciones', nuevaPresentacion({
    producto_id: producto.producto_id,
    tienda: c.tienda,
    nombre_en_tienda: c.nombre,
    marca: c.marca,
    contenido,
    sku_id: c.skuId,
    ean: c.ean,
    vtex_product_id: c.productId,
    url: c.url,
    auto: true,
  }))
  if (c.precio != null) {
    await registrarObservaciones([observacion({ presentacion: p, precio: c.precio, precioLista: c.precioLista, origen: 'online', fuente: 'auto', disponible: c.disponible, region: c.region })])
  }
  return p
}

/** Productos activos sin ninguna presentación online en Olímpica ni Éxito. */
export async function productosSinVincular(): Promise<Producto[]> {
  const [productos, presentaciones] = await Promise.all([db.productos.toArray(), db.presentaciones.toArray()])
  const conOnline = new Set(presentaciones.filter((p) => p.activo && p.sku_id && TIENDAS_LOTE.includes(p.tienda as TiendaVtex)).map((p) => p.producto_id))
  return productos.filter((p) => p.activo && !conOnline.has(p.producto_id))
}

type Item = { id: string; q?: string; ean?: string; unidad: UnidadBase }

/** Busca de a 8 productos por llamada. Si el servidor no responde, se detiene y lo dice. */
export async function buscarLote(items: Item[], tiendas: TiendaVtex[] = TIENDAS_LOTE, onAvance?: (hechos: number, total: number) => void) {
  const resultados = new Map<string, PorTienda>()
  const errores = new Set<string>()
  const c = await conexion()
  for (let i = 0; i < items.length; i += LOTE) {
    onAvance?.(i, items.length)
    const r = await llamar<{ resultados: { id: string; porTienda: PorTienda }[]; errores: string[] }>(c, 'buscarVarios', { items: items.slice(i, i + LOTE), tiendas }, 90_000)
    if (r.tipo !== 'ok') return { resultados, errores: [...errores], fallo: r.tipo === 'error' ? r.mensaje : 'Sin respuesta. ¿Hay señal?' }
    for (const x of r.data?.resultados ?? []) resultados.set(x.id, x.porTienda)
    for (const e of r.data?.errores ?? []) errores.add(e)
  }
  onAvance?.(items.length, items.length)
  return { resultados, errores: [...errores], fallo: null as string | null }
}

/** La opción segura de cada tienda, si la hay. */
export function seguros(porTienda: PorTienda | undefined): OpcionLote[] {
  return TIENDAS_LOTE.flatMap((t) => porTienda?.[t]?.filter((o) => o.seguro).slice(0, 1) ?? [])
}

/** Todas las opciones de un producto, de la más a la menos parecida. */
export function opcionesDe(porTienda: PorTienda | undefined): OpcionLote[] {
  return TIENDAS_LOTE.flatMap((t) => porTienda?.[t] ?? []).sort((a, b) => b.puntaje - a.puntaje)
}

export interface Elegido {
  producto: Producto
  opciones: OpcionLote[]
}

/**
 * Vincula lo elegido. Si un producto quedó sin alguna de las dos tiendas, busca su código de barras en la otra
 * y lo agrega si está (mismo producto, así que es seguro). Devuelve cuántos productos quedaron vinculados.
 */
export async function vincular(elegidos: Elegido[], onAvance?: (hechos: number, total: number) => void): Promise<number> {
  const conEan: Item[] = []
  const faltaEn = new Map<string, TiendaVtex[]>()
  let n = 0
  for (const e of elegidos) {
    onAvance?.(n++, elegidos.length)
    for (const o of e.opciones) await crearDesdeCandidato(e.producto, o, o.contenido!.valor)
    const faltan = TIENDAS_LOTE.filter((t) => !e.opciones.some((o) => o.tienda === t))
    const ean = e.opciones.find((o) => o.ean)?.ean
    if (faltan.length && ean) {
      conEan.push({ id: e.producto.producto_id, ean, unidad: e.producto.unidad_base })
      faltaEn.set(e.producto.producto_id, faltan)
    }
  }
  if (conEan.length) {
    const { resultados } = await buscarLote(conEan)
    for (const e of elegidos) {
      const faltan = faltaEn.get(e.producto.producto_id)
      if (!faltan) continue
      for (const o of seguros(resultados.get(e.producto.producto_id)).filter((x) => faltan.includes(x.tienda))) {
        await crearDesdeCandidato(e.producto, o, o.contenido!.valor)
      }
    }
  }
  onAvance?.(elegidos.length, elegidos.length)
  return elegidos.filter((e) => e.opciones.length).length
}

interface EstadoAuto {
  ultimo: number
  /** Productos revisados sin opción segura: no se vuelven a buscar solos por unos días. */
  revisados: Record<string, number>
}

let enCurso: Promise<ResultadoAuto | null> | null = null
export interface ResultadoAuto {
  vinculados: number
  dudosos: number
  sinResultado: number
}

/**
 * Lo automático: busca los productos sin precio de internet y vincula solos los que coinciden sin duda.
 * Corre al abrir la app (una vez al día) y después de pegar la lista (forzar). Los dudosos quedan para revisar.
 */
export function autoVincular(opciones: { forzar?: boolean } = {}): Promise<ResultadoAuto | null> {
  if (enCurso) return enCurso
  enCurso = (async () => {
    try {
      const c = await conexion()
      if (!c.url || !c.token) return null
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return null
      const estado = await leerMeta<EstadoAuto>('autoVinculo', { ultimo: 0, revisados: {} })
      const ahora = Date.now()
      if (!opciones.forzar && ahora - estado.ultimo < HORAS_ENTRE_AUTOMATICOS * 3600_000) return null
      const recientes = (id: string) => ahora - (estado.revisados[id] ?? 0) < DIAS_SIN_REPETIR * 86400_000
      const pendientes = (await productosSinVincular()).filter((p) => opciones.forzar || !recientes(p.producto_id))
      if (!pendientes.length) {
        await guardarMeta('autoVinculo', { ...estado, ultimo: ahora })
        return { vinculados: 0, dudosos: 0, sinResultado: 0 }
      }
      const { resultados, fallo } = await buscarLote(pendientes.map((p) => ({ id: p.producto_id, q: p.nombre, unidad: p.unidad_base })))
      const elegidos: Elegido[] = []
      let dudosos = 0
      let sinResultado = 0
      const revisados = { ...estado.revisados }
      for (const p of pendientes) {
        const porTienda = resultados.get(p.producto_id)
        if (!porTienda) continue
        const s = seguros(porTienda)
        if (s.length) elegidos.push({ producto: p, opciones: s })
        else {
          revisados[p.producto_id] = ahora
          if (opcionesDe(porTienda).length) dudosos++
          else sinResultado++
        }
      }
      const vinculados = await vincular(elegidos)
      await guardarMeta('autoVinculo', { ultimo: fallo ? estado.ultimo : ahora, revisados })
      return { vinculados, dudosos, sinResultado }
    } finally {
      enCurso = null
    }
  })()
  return enCurso
}
