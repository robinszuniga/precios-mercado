import type { Detalle } from './esquema.ts'

export type ColorPresupuesto = 'verde' | 'amarillo' | 'rojo'

export interface EstadoPresupuesto {
  gastado: number
  /** Gastado + lo que falta por comprar, estimado con los precios conocidos. */
  proyectado: number
  presupuesto: number | null
  restante: number | null
  /** Lo que sobraría (positivo) o faltaría (negativo) al terminar, según lo proyectado. */
  alTerminar: number | null
  /** gastado / presupuesto. null sin presupuesto. */
  proporcion: number | null
  proporcionProyectada: number | null
  color: ColorPresupuesto | null
  /** Por qué el color: 'pasado' ya se pasó; 'pasaria' se pasaría con lo que falta; 'cerca' llegó a la alerta. */
  motivo: 'ok' | 'cerca' | 'pasaria' | 'pasado' | null
}

export function subtotal(cantidad: number | null, precioUnitario: number | null): number {
  if (cantidad == null || precioUnitario == null) return 0
  return Math.round(cantidad * precioUnitario)
}

/**
 * Rojo si ya se pasó. Amarillo si lo gastado llegó a la alerta (85 %) o si, con lo que falta, se pasaría:
 * así avisa antes de que sea tarde. Verde en otro caso.
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
    return { gastado, proyectado, presupuesto: null, restante: null, alTerminar: null, proporcion: null, proporcionProyectada: null, color: null, motivo: null }
  }
  const proporcion = gastado / presupuesto
  const proporcionProyectada = proyectado / presupuesto
  let motivo: EstadoPresupuesto['motivo'] = 'ok'
  if (proporcion > 1) motivo = 'pasado'
  else if (proporcionProyectada > 1) motivo = 'pasaria'
  else if (proporcion >= alerta) motivo = 'cerca'
  const color: ColorPresupuesto = motivo === 'pasado' ? 'rojo' : motivo === 'ok' ? 'verde' : 'amarillo'
  return {
    gastado, proyectado, presupuesto, restante: presupuesto - gastado, alTerminar: presupuesto - proyectado,
    proporcion, proporcionProyectada, color, motivo,
  }
}
