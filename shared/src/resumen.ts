import { claveResumen, type Detalle, type PrecioActual, type Presentacion, type Producto, type ResumenTienda } from './esquema.ts'
import type { Vigencias } from './precioEfectivo.ts'
import { opcionesProducto } from './recomendacion.ts'
import { TIENDAS, type Tienda } from './tiendas.ts'
import { factorVisible } from './unidades.ts'

export interface Referencia {
  tienda: Tienda
  /** Lo que habría costado en esa tienda lo comparado. */
  total: number
  /** Lo que se gastó de verdad en esos mismos ítems. */
  gastado: number
  itemsComparados: number
  itemsTotal: number
  /** Positivo = ahorraste. Negativo = gastaste más que comprando todo ahí. */
  ahorro: number
  completa: boolean
}

export interface ResultadoCierre {
  totalFinal: number
  filas: ResumenTienda[]
  referencia: Referencia | null
  /** Ítems en el carrito que no se pueden comparar (libres o sin contenido). */
  noComparables: number
}

interface Comparable {
  detalle: Detalle
  producto: Producto
  /** En kg, L o und. */
  cantidadVisible: number
}

/**
 * Resumen que queda congelado al cerrar la compra. Se calcula DESPUÉS de guardar como precios de tienda
 * lo que se pagó, así la tienda visitada queda con sus precios reales.
 * Referencia: la tienda más barata que tiene todo; si ninguna, la de mayor cobertura sobre lo que cubre.
 */
export function resumenCierre(args: {
  compraId: string
  detalles: readonly Detalle[]
  productos: ReadonlyMap<string, Producto>
  presentaciones: readonly Presentacion[]
  actualesPorPresentacion: ReadonlyMap<string, PrecioActual[]>
  vigencias: Vigencias
  ahora: string
}): ResultadoCierre {
  const { compraId, detalles, productos, presentaciones, actualesPorPresentacion, vigencias, ahora } = args
  const enCarrito = detalles.filter((d) => !d.borrado && d.estado === 'en_carrito')
  const totalFinal = enCarrito.reduce((s, d) => s + (d.subtotal ?? 0), 0)

  const presPorId = new Map(presentaciones.map((p) => [p.presentacion_id, p]))
  const comparables: Comparable[] = []
  for (const d of enCarrito) {
    const producto = d.producto_id ? productos.get(d.producto_id) : undefined
    const pres = d.presentacion_id ? presPorId.get(d.presentacion_id) : undefined
    if (!producto || !pres || !pres.contenido || !(pres.contenido > 0) || d.cantidad == null) continue
    comparables.push({ detalle: d, producto, cantidadVisible: (d.cantidad * pres.contenido) / factorVisible(producto.unidad_base) })
  }

  const porTienda = new Map<Tienda, { total: number; gastado: number; ids: Set<string> }>()
  for (const t of TIENDAS) porTienda.set(t, { total: 0, gastado: 0, ids: new Set() })
  for (const c of comparables) {
    const presDelProducto = presentaciones.filter((p) => p.producto_id === c.producto.producto_id)
    const ops = opcionesProducto(presDelProducto, actualesPorPresentacion, c.producto.unidad_base, vigencias, ahora)
    for (const t of TIENDAS) {
      const op = ops.porTienda[t]
      if (!op || op.precioUnidad == null) continue
      const acc = porTienda.get(t)!
      acc.total += c.cantidadVisible * op.precioUnidad
      acc.gastado += c.detalle.subtotal ?? 0
      acc.ids.add(c.detalle.detalle_id)
    }
  }

  const n = comparables.length
  const filas: ResumenTienda[] = TIENDAS.filter((t) => porTienda.get(t)!.ids.size > 0).map((t) => {
    const acc = porTienda.get(t)!
    return {
      clave: claveResumen(compraId, t),
      compra_id: compraId,
      tienda: t,
      total_hipotetico: Math.round(acc.total),
      items_con_precio: acc.ids.size,
      items_total: n,
      completo: acc.ids.size === n,
      created_at: ahora,
    }
  })

  let referencia: Referencia | null = null
  const completas = filas.filter((f) => f.completo).sort((a, b) => a.total_hipotetico - b.total_hipotetico)
  const elegida =
    completas[0] ??
    [...filas].sort((a, b) => b.items_con_precio - a.items_con_precio || a.total_hipotetico - b.total_hipotetico)[0]
  if (elegida && n > 0) {
    const acc = porTienda.get(elegida.tienda)!
    const gastado = Math.round(acc.gastado)
    referencia = {
      tienda: elegida.tienda,
      total: elegida.total_hipotetico,
      gastado,
      itemsComparados: elegida.items_con_precio,
      itemsTotal: n,
      ahorro: elegida.total_hipotetico - gastado,
      completa: elegida.completo,
    }
  }
  return { totalFinal, filas, referencia, noComparables: enCarrito.length - n }
}
