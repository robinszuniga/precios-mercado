import { productoEliminado, type PrecioActual, type Presentacion, type Producto } from '@shared/esquema.ts'
import { esTiendaVtex } from '@shared/tiendas.ts'

/** Un precio de internet de hace menos de esto no se vuelve a pedir: gastaría cuota para obtener casi lo mismo. */
export const FRESCO_MS = 10 * 60_000

/**
 * Las presentaciones cuyo precio de internet toca pedir, las más atrasadas primero. El servidor deja unas 56 por minuto:
 * en una lista larga, empezar siempre por las mismas dejaría el resto sin actualizar nunca; así cada vez se avanza.
 * Se saltan las de productos archivados o eliminados (no se ven en la lista) y las que ya se consultaron hace poco.
 */
export function presentacionesPorActualizar(
  presentaciones: readonly Presentacion[],
  productos: readonly Producto[],
  precios: readonly PrecioActual[],
  ahora: number,
): Presentacion[] {
  const vivos = new Set(productos.filter((p) => p.activo && !productoEliminado(p)).map((p) => p.producto_id))
  const ultimo = new Map<string, number>()
  for (const x of precios) {
    if (x.origen !== 'online') continue
    const t = Date.parse(x.fecha_verificado)
    if (!Number.isNaN(t)) ultimo.set(x.presentacion_id, Math.max(ultimo.get(x.presentacion_id) ?? 0, t))
  }
  return presentaciones
    .filter((p) => p.activo && p.auto && (p.sku_id || p.ean) && esTiendaVtex(p.tienda) && vivos.has(p.producto_id)
      && ahora - (ultimo.get(p.presentacion_id) ?? 0) >= FRESCO_MS)
    // Las que la tienda no encontró la última vez van al final: no registran precio, así que si no, su fecha vieja las dejaría
    // siempre al frente y gastarían la cuota de cada vuelta sin que las demás avancen.
    .sort((a, b) => Number(!!a.ultimo_error) - Number(!!b.ultimo_error)
      || (ultimo.get(a.presentacion_id) ?? 0) - (ultimo.get(b.presentacion_id) ?? 0))
}
