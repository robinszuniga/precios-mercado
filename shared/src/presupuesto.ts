import type { Detalle } from './esquema.ts'

export type ColorPresupuesto = 'verde' | 'amarillo' | 'rojo'

export interface EstadoPresupuesto {
  gastado: number
  /** Gastado + lo que falta por comprar, estimado con los precios conocidos. */
  proyectado: number
  presupuesto: number | null
  restante: number | null
  /** gastado / presupuesto. null sin presupuesto. */
  proporcion: number | null
  color: ColorPresupuesto | null
}

export function subtotal(cantidad: number | null, precioUnitario: number | null): number {
  if (cantidad == null || precioUnitario == null) return 0
  return Math.round(cantidad * precioUnitario)
}

/**
 * Verde por debajo de la alerta (85 %), amarillo desde la alerta hasta el 100 % inclusive, rojo al pasarse.
 * `estimadoPendientes` es la suma estimada de los ítems que siguen pendientes.
 */
export function estadoPresupuesto(
  detalles: readonly Pick<Detalle, 'estado' | 'cantidad' | 'precio_unitario' | 'borrado'>[],
  presupuesto: number | null,
  alerta: number,
  estimadoPendientes = 0,
): EstadoPresupuesto {
  const gastado = detalles
    .filter((d) => !d.borrado && d.estado === 'en_carrito')
    .reduce((s, d) => s + subtotal(d.cantidad, d.precio_unitario), 0)
  const proyectado = gastado + Math.round(estimadoPendientes)
  if (presupuesto == null || !(presupuesto > 0)) {
    return { gastado, proyectado, presupuesto: null, restante: null, proporcion: null, color: null }
  }
  const proporcion = gastado / presupuesto
  const color: ColorPresupuesto = proporcion > 1 ? 'rojo' : proporcion >= alerta ? 'amarillo' : 'verde'
  return { gastado, proyectado, presupuesto, restante: presupuesto - gastado, proporcion, color }
}
