import { useLiveQuery } from 'dexie-react-hooks'
import { leerConfig, type Config } from '@shared/config.ts'
import { productoEliminado, type Categoria, type Detalle, type PrecioActual, type Presentacion, type Producto } from '@shared/esquema.ts'
import { costoEnTienda, opcionesProducto, type ItemPlan, type OpcionesProducto } from '@shared/recomendacion.ts'
import { TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { db } from './db.ts'

export interface Catalogo {
  productos: Producto[]
  producto: Map<string, Producto>
  presentaciones: Presentacion[]
  presentacionesDe: Map<string, Presentacion[]>
  actualesDe: Map<string, PrecioActual[]>
  categorias: Categoria[]
  cfg: Config
}

export async function cargarCatalogo(): Promise<Catalogo> {
  const [todosLosProductos, todasLasPresentaciones, actuales, categorias, config] = await Promise.all([
    db.productos.toArray(), db.presentaciones.toArray(), db.preciosActuales.toArray(), db.categorias.toArray(), db.config.toArray(),
  ])
  // Un producto eliminado (y lo que aún quede suyo por una descarga atrasada) no se muestra en ninguna parte.
  const productos = todosLosProductos.filter((p) => !productoEliminado(p))
  const eliminados = new Set(todosLosProductos.filter(productoEliminado).map((p) => p.producto_id))
  const presentaciones = eliminados.size ? todasLasPresentaciones.filter((p) => !eliminados.has(p.producto_id)) : todasLasPresentaciones
  const presentacionesDe = new Map<string, Presentacion[]>()
  for (const p of presentaciones) presentacionesDe.set(p.producto_id, [...(presentacionesDe.get(p.producto_id) ?? []), p])
  const actualesDe = new Map<string, PrecioActual[]>()
  for (const a of actuales) actualesDe.set(a.presentacion_id, [...(actualesDe.get(a.presentacion_id) ?? []), a])
  return {
    productos: productos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    producto: new Map(productos.map((p) => [p.producto_id, p])),
    presentaciones,
    presentacionesDe,
    actualesDe,
    categorias: categorias.filter((c) => !c.borrado).sort((a, b) => a.orden - b.orden),
    cfg: leerConfig(config),
  }
}

export function useCatalogo(): Catalogo | undefined {
  return useLiveQuery(cargarCatalogo, [])
}

export function opcionesDe(cat: Catalogo, producto: Producto, ahora: string, tiendas?: readonly Tienda[]): OpcionesProducto {
  return opcionesProducto(cat.presentacionesDe.get(producto.producto_id) ?? [], cat.actualesDe, producto.unidad_base, cat.cfg.vigencias, ahora, tiendas)
}

/** Ítems pendientes de la lista listos para el plan: costo en cada tienda de hoy. */
export function itemsDelPlan(cat: Catalogo, detalles: readonly Detalle[], ahora: string, tiendasHoy: readonly Tienda[]): ItemPlan[] {
  const items: ItemPlan[] = []
  for (const d of detalles) {
    if (d.borrado || d.estado !== 'pendiente' || !d.producto_id) continue
    const p = cat.producto.get(d.producto_id)
    if (!p) continue
    const ops = opcionesDe(cat, p, ahora, tiendasHoy)
    const costos: ItemPlan['costos'] = {}
    for (const t of TIENDAS) {
      const op = ops.porTienda[t]
      if (op) costos[t] = costoEnTienda(op, d.necesidad ?? p.cantidad_habitual ?? 1, p.unidad_base)
    }
    items.push({ id: d.detalle_id, costos, fijo: d.tienda || undefined })
  }
  return items
}

export function useMeta<T>(clave: string, porDefecto: T): T {
  return useLiveQuery(async () => ((await db.meta.get(clave))?.valor as T) ?? porDefecto, [clave]) ?? porDefecto
}

/** Para ordenar como se recorre el súper: pasillo (según Ajustes) y luego nombre. */
export function comparadorPasillo(cat: Catalogo) {
  const orden = new Map(cat.categorias.map((c, i) => [c.categoria_id, i]))
  const clave = (productoId: string) => {
    const p = cat.producto.get(productoId)
    return { o: p ? (orden.get(p.categoria_id) ?? 999) : 1000, n: p?.nombre ?? '' }
  }
  return (a: string, b: string) => {
    const x = clave(a)
    const y = clave(b)
    return x.o - y.o || x.n.localeCompare(y.n, 'es')
  }
}
