import type { Presentacion, Producto, Region } from '@shared/esquema.ts'
import type { TiendaVtex } from '@shared/tiendas.ts'
import type { UnidadBase } from '@shared/unidades.ts'
import { esDeMarca, type Opcion } from '@shared/vtex/ordenar.ts'
import type { Candidato } from '@shared/vtex/parse.ts'
import { llamar } from './api.ts'
import { db, guardarMeta, leerMeta } from './db.ts'
import { compraAbierta, guardar, nuevaPresentacion, observacion, registrarObservaciones } from './escritura.ts'
import { conexion, sincronizar } from './sync.ts'

export type Cand = Candidato & { region: Region }
export type OpcionLote = Opcion<Cand>
type PorTienda = Partial<Record<TiendaVtex, OpcionLote[]>>

/** Las tiendas que publican precio online útil para Riohacha (D1 no atiende Riohacha; Ara no vende online). */
export const TIENDAS_LOTE: TiendaVtex[] = ['OLIMPICA', 'EXITO']
const LOTE = 8
const HORAS_ENTRE_AUTOMATICOS = 20
const DIAS_SIN_REPETIR = 7
const HORAS_TRAS_FALLO = 1

let candado: Promise<unknown> = Promise.resolve()

/** La búsqueda automática y "Buscar precios" no corren a la vez (si no, vincularían dos veces lo mismo). */
export function exclusivo<T>(fn: () => Promise<T>): Promise<T> {
  const r = candado.then(fn, fn)
  candado = r.catch(() => undefined)
  return r
}

/**
 * Crea la presentación de la tienda para el producto y guarda el precio que trajo la búsqueda.
 * Si ese SKU ya está vinculado al producto no lo repite; si el usuario lo había quitado, solo lo vuelve a poner
 * cuando él mismo lo elige (`reactivar`), nunca la búsqueda automática.
 */
export async function crearDesdeCandidato(producto: Producto, c: Cand, contenido: number | null, opciones: { reactivar?: boolean } = {}): Promise<Presentacion | null> {
  const previa = (await db.presentaciones.where('producto_id').equals(producto.producto_id).toArray())
    .find((x) => x.tienda === c.tienda && x.sku_id === c.skuId)
  if (previa && !previa.activo && !opciones.reactivar) return null
  const [p] = previa
    ? previa.activo ? [previa] : await guardar<Presentacion>('Presentaciones', { ...previa, activo: true, contenido: contenido ?? previa.contenido })
    : await guardar<Presentacion>('Presentaciones', nuevaPresentacion({
      // Id fijo: si dos celulares vinculan lo mismo, en el Sheet queda una sola fila.
      presentacion_id: `auto-${producto.producto_id}-${c.tienda}-${c.skuId}`,
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

/**
 * Productos activos sin ninguna presentación online en Olímpica ni Éxito. Los que tuvieron un vínculo automático
 * que el usuario quitó ya se revisaron: no se vuelven a buscar solos (se pueden vincular a mano).
 */
export async function productosSinVincular(): Promise<Producto[]> {
  const [productos, presentaciones] = await Promise.all([db.productos.toArray(), db.presentaciones.toArray()])
  const online = presentaciones.filter((p) => p.sku_id && TIENDAS_LOTE.includes(p.tienda as TiendaVtex))
  const revisado = new Set(online.filter((p) => p.activo || p.auto).map((p) => p.producto_id))
  return productos.filter((p) => p.activo && !revisado.has(p.producto_id))
}

type Item = { id: string; q?: string; ean?: string; unidad: UnidadBase; marca?: string }

/** Lo que se busca de un producto: su nombre y, si tiene, su marca preferida. */
export function itemDe(p: Producto): Item {
  return { id: p.producto_id, q: p.nombre, unidad: p.unidad_base, ...(p.marca ? { marca: p.marca } : {}) }
}

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

/**
 * La opción segura de cada tienda, si la hay. Con marca preferida, solo si es de esa marca (el servidor ya lo
 * cuida; esto protege también frente a un script que todavía no conoce las marcas).
 */
export function seguros(porTienda: PorTienda | undefined, marca?: string): OpcionLote[] {
  return TIENDAS_LOTE.flatMap((t) => porTienda?.[t]?.filter((o) => o.seguro && esDeMarca(o, marca)).slice(0, 1) ?? [])
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
export async function vincular(elegidos: Elegido[], onAvance?: (hechos: number, total: number) => void, opciones: { reactivar?: boolean } = {}): Promise<number> {
  const conEan: Item[] = []
  const faltaEn = new Map<string, TiendaVtex[]>()
  const hechos = new Set<string>()
  let n = 0
  for (const e of elegidos) {
    onAvance?.(n++, elegidos.length)
    for (const o of e.opciones) {
      if (await crearDesdeCandidato(e.producto, o, o.contenido!.valor, opciones)) hechos.add(e.producto.producto_id)
    }
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
        if (await crearDesdeCandidato(e.producto, o, o.contenido!.valor)) hechos.add(e.producto.producto_id)
      }
    }
  }
  onAvance?.(elegidos.length, elegidos.length)
  return hechos.size
}

interface EstadoAuto {
  ultimo: number
  /** Última vez que la búsqueda falló (sin señal, script viejo): se espera un rato antes de reintentar. */
  fallo?: number
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
 * No corre en plena compra (movería los productos entre tiendas mientras marcas), salvo que se fuerce.
 */
export function autoVincular(opciones: { forzar?: boolean } = {}): Promise<ResultadoAuto | null> {
  // Si ya hay una corriendo y se pide forzar (acabas de pegar la lista), se corre otra después con lo nuevo.
  if (enCurso) return opciones.forzar ? enCurso.then(() => autoVincular(opciones)) : enCurso
  enCurso = exclusivo(() => correrAuto(opciones)).finally(() => { enCurso = null })
  return enCurso
}

async function correrAuto(opciones: { forzar?: boolean }): Promise<ResultadoAuto | null> {
  const c = await conexion()
  if (!c.url || !c.token) return null
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null
  const estado = await leerMeta<EstadoAuto>('autoVinculo', { ultimo: 0, revisados: {} })
  const ahora = Date.now()
  if (!opciones.forzar) {
    if (ahora - estado.ultimo < HORAS_ENTRE_AUTOMATICOS * 3600_000) return null
    if (estado.fallo && ahora - estado.fallo < HORAS_TRAS_FALLO * 3600_000) return null
    if ((await compraAbierta())?.estado === 'en_curso') return null
  }
  // Primero lo último del Sheet: otro celular pudo haber vinculado ya estos productos.
  await sincronizar()
  const recientes = (id: string) => ahora - (estado.revisados[id] ?? 0) < DIAS_SIN_REPETIR * 86400_000
  const pendientes = (await productosSinVincular()).filter((p) => opciones.forzar || !recientes(p.producto_id))
  if (!pendientes.length) {
    await guardarMeta('autoVinculo', { ...estado, ultimo: ahora })
    return { vinculados: 0, dudosos: 0, sinResultado: 0 }
  }
  const { resultados, fallo } = await buscarLote(pendientes.map(itemDe))
  const elegidos: Elegido[] = []
  let dudosos = 0
  let sinResultado = 0
  const revisados = { ...estado.revisados }
  for (const p of pendientes) {
    const porTienda = resultados.get(p.producto_id)
    if (!porTienda) continue
    const s = seguros(porTienda, p.marca)
    if (s.length) elegidos.push({ producto: p, opciones: s })
    else {
      revisados[p.producto_id] = ahora
      if (opcionesDe(porTienda).length) dudosos++
      else sinResultado++
    }
  }
  const vinculados = await vincular(elegidos)
  await guardarMeta('autoVinculo', fallo ? { ...estado, revisados, fallo: ahora } : { ultimo: ahora, revisados })
  return { vinculados, dudosos, sinResultado }
}

export interface ResultadoMarca {
  /** Tiendas donde quedó vinculada la marca preferida. */
  con: TiendaVtex[]
  /** Tiendas online donde no apareció esa marca (se deja lo que había). */
  sin: TiendaVtex[]
}

/**
 * Al elegir la marca preferida de un producto: la busca en Olímpica y Éxito y, donde la encuentra sin duda, la
 * vincula y quita el vínculo a otra marca en esa tienda. Donde no está, deja lo que había (mejor un precio de otra
 * marca que ninguno). Null si no hay copia en Google o no hubo respuesta.
 */
export function vincularMarca(producto: Producto): Promise<ResultadoMarca | null> {
  return exclusivo(async () => {
    const c = await conexion()
    if (!c.url || !c.token || !producto.marca) return null
    const { resultados, fallo } = await buscarLote([itemDe(producto)])
    if (fallo) return null
    const antes = await db.presentaciones.where('producto_id').equals(producto.producto_id).toArray()
    const con: TiendaVtex[] = []
    for (const o of seguros(resultados.get(producto.producto_id), producto.marca)) {
      const nueva = await crearDesdeCandidato(producto, o, o.contenido!.valor, { reactivar: true })
      if (!nueva) continue
      con.push(o.tienda)
      const otras = antes.filter((x) => x.tienda === o.tienda && x.activo && x.sku_id && x.presentacion_id !== nueva.presentacion_id
        && !esDeMarca({ nombre: x.nombre_en_tienda, marca: x.marca }, producto.marca))
      if (otras.length) await guardar<Presentacion>('Presentaciones', otras.map((x) => ({ ...x, activo: false })))
    }
    return { con, sin: TIENDAS_LOTE.filter((t) => !con.includes(t)) }
  })
}
