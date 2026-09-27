import type { PrecioActual, Presentacion, Producto } from '../src/esquema.ts'
import type { Tienda } from '../src/tiendas.ts'

export const AHORA = '2026-09-27T10:00:00.000-05:00'

export function haceDias(d: number, desde = AHORA): string {
  const ms = Date.parse(desde) - d * 86400000
  return new Date(ms - 5 * 3600000).toISOString().slice(0, 23) + '-05:00'
}

export function producto(p: Partial<Producto> = {}): Producto {
  return {
    producto_id: 'arroz', nombre: 'Arroz', categoria_id: 'granos', unidad_base: 'g', recurrente: true,
    cantidad_habitual: 2, notas: '', activo: true, updated_at: AHORA, ...p,
  }
}

export function pres(id: string, tienda: Tienda, contenido: number | null, p: Partial<Presentacion> = {}): Presentacion {
  return {
    presentacion_id: id, producto_id: 'arroz', tienda, nombre_en_tienda: id, marca: '', contenido, granel: false,
    sku_id: '', ean: '', vtex_product_id: '', url: '', auto: false, activo: true, ultimo_error: '', updated_at: AHORA, ...p,
  }
}

export function actual(presentacion_id: string, tienda: Tienda, origen: 'online' | 'tienda', precio: number | null, dias: number, extra: Partial<PrecioActual> = {}): PrecioActual {
  const f = haceDias(dias)
  return {
    clave: `${presentacion_id}|${origen}`, presentacion_id, tienda, origen, fuente: origen === 'online' ? 'auto' : 'manual',
    precio, precio_lista: null, disponible: true, region: origen === 'online' ? 'RIOHACHA' : '', fecha_observado: f,
    fecha_verificado: f, ...extra,
  }
}

/** Producto con la forma de la respuesta de products/search (documentación VTEX). */
export function productoVtex(o: {
  productId?: string; nombre: string; marca?: string; skus: {
    itemId: string; ean?: string; sellers: { sellerId: string; def?: boolean; price: number; list?: number; qty?: number }[]
    measurementUnit?: string; unitMultiplier?: number
  }[]; extra?: Record<string, unknown>
}) {
  return {
    productId: o.productId ?? '100',
    productName: o.nombre,
    brand: o.marca ?? 'Marca',
    link: `https://www.exito.com/${o.productId ?? '100'}/p`,
    linkText: 'x',
    ...o.extra,
    items: o.skus.map((s) => ({
      itemId: s.itemId,
      ean: s.ean ?? '',
      name: o.nombre,
      measurementUnit: s.measurementUnit ?? 'un',
      unitMultiplier: s.unitMultiplier ?? 1,
      sellers: s.sellers.map((x) => ({
        sellerId: x.sellerId,
        sellerDefault: x.def ?? false,
        commertialOffer: { Price: x.price, ListPrice: x.list ?? x.price, PriceWithoutDiscount: x.price, AvailableQuantity: x.qty ?? 10000, IsAvailable: (x.qty ?? 1) > 0 },
      })),
    })),
  }
}
