import type { Detalle } from '@shared/esquema.ts'

/**
 * Qué línea de compra se muestra y cómo, cuando su producto ya no existe (se eliminó: solo queda una marca).
 * Se decide al mostrar, con lo que ya está sincronizado, así que todos los celulares ven lo mismo sin importar en qué orden se
 * enteraron; nada se reescribe ni se envía.
 * - Quitada por la persona (`borrado`): no se muestra. La eliminación de un producto nunca marca líneas como borradas, así que
 *   `borrado` siempre significa «la quité yo».
 * - En el carrito: ya se compró, la plata ya se gastó: se muestra como texto («Producto eliminado» si no se conoce el nombre) y
 *   suma en el total, igual que en el Historial.
 * - Pendiente o «no lo encontré»: no hay nada que comprar; no se muestra.
 */
export function lineaVisible(d: Detalle, existe: (productoId: string) => boolean): Detalle | null {
  if (d.borrado) return null
  if (!d.producto_id || existe(d.producto_id)) return d
  if (d.estado !== 'en_carrito') return null
  return { ...d, producto_id: '', nombre_libre: d.nombre_libre || 'Producto eliminado' }
}

export function lineasVisibles(detalles: readonly Detalle[], existe: (productoId: string) => boolean): Detalle[] {
  return detalles.flatMap((d) => {
    const v = lineaVisible(d, existe)
    return v ? [v] : []
  })
}
