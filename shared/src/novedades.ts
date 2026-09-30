import type { Tienda } from './tiendas.ts'
const DIA_MS = 86_400_000
/** Día calendario en Bogotá (UTC-5): una compra a las 8 p. m. es de ese día, no del siguiente. */
const diaBogota = (iso: string) => Math.floor((Date.parse(iso) - 5 * 3_600_000) / DIA_MS)

/** Un precio que cambió al llegar del servidor (trabajo diario o búsqueda). */
export interface CambioPrecio {
  id?: number
  presentacion_id: string
  tienda: Tienda
  antes: number
  despues: number
  /** Cuándo lo vio el celular (ms). */
  fecha: number
}

/** Solo cuenta si el precio de verdad cambió y es una observación más nueva (no una copia repetida). */
export function detectarCambio(
  local: { precio: number | null; fecha_observado: string } | undefined,
  remoto: { precio: number | null; fecha_observado: string },
): { antes: number; despues: number } | null {
  if (!local || local.precio == null || remoto.precio == null || !(local.precio > 0) || !(remoto.precio > 0)) return null
  if (local.precio === remoto.precio || remoto.fecha_observado <= local.fecha_observado) return null
  return { antes: local.precio, despues: remoto.precio }
}

export interface Movimiento extends CambioPrecio {
  /** Variación en fracción: -0.18 = bajó 18 %. */
  variacion: number
}

/**
 * Lo que vale contar: el último cambio de cada presentación en los últimos días, desde el primer precio de esa
 * ventana, si se movió al menos `minimo` (5 %). Bajas y subidas, de mayor a menor movimiento.
 */
export function resumirCambios(cambios: readonly CambioPrecio[], ahoraMs: number, opciones: { dias?: number; minimo?: number } = {}) {
  const desde = ahoraMs - (opciones.dias ?? 3) * DIA_MS
  const minimo = opciones.minimo ?? 0.05
  const porPresentacion = new Map<string, CambioPrecio[]>()
  for (const c of cambios) {
    if (c.fecha < desde) continue
    porPresentacion.set(c.presentacion_id, [...(porPresentacion.get(c.presentacion_id) ?? []), c])
  }
  const movimientos: Movimiento[] = []
  for (const xs of porPresentacion.values()) {
    xs.sort((a, b) => a.fecha - b.fecha)
    const ultimo = xs[xs.length - 1]
    const antes = xs[0].antes
    const variacion = (ultimo.despues - antes) / antes
    if (Math.abs(variacion) >= minimo) movimientos.push({ ...ultimo, antes, variacion })
  }
  const orden = (a: Movimiento, b: Movimiento) => Math.abs(b.variacion) - Math.abs(a.variacion)
  return {
    bajas: movimientos.filter((m) => m.variacion < 0).sort(orden),
    subidas: movimientos.filter((m) => m.variacion > 0).sort(orden),
  }
}

export interface TeToca {
  producto_id: string
  /** Cada cuántos días lo compras (mediana). */
  cadaDias: number
  /** Días desde la última compra. */
  haceDias: number
}

/**
 * Productos que sueles comprar cada cierto tiempo y ya les toca: al menos dos compras cerradas con el producto
 * en el carrito, cada 3 días o más, y ya pasó (casi) ese tiempo. Del más atrasado al menos.
 */
export function teTocaComprar(
  compras: readonly { compra_id: string; estado: string; fecha_cierre: string; borrado?: boolean }[],
  detalles: readonly { compra_id: string; producto_id: string; estado: string; borrado?: boolean }[],
  hoy: string,
): TeToca[] {
  const cierre = new Map(compras.filter((c) => c.estado === 'cerrada' && !c.borrado && !Number.isNaN(Date.parse(c.fecha_cierre)))
    .map((c) => [c.compra_id, diaBogota(c.fecha_cierre)]))
  const fechas = new Map<string, Set<number>>()
  for (const d of detalles) {
    const dia = cierre.get(d.compra_id)
    if (dia == null || d.borrado || d.estado !== 'en_carrito' || !d.producto_id) continue
    // Por día: dos compras el mismo día cuentan como una.
    fechas.set(d.producto_id, (fechas.get(d.producto_id) ?? new Set()).add(dia))
  }
  const hoyDia = diaBogota(hoy)
  const out: TeToca[] = []
  for (const [producto_id, set] of fechas) {
    const dias = [...set].sort((a, b) => a - b)
    if (dias.length < 2) continue
    const saltos = dias.slice(1).map((d, i) => d - dias[i]).sort((a, b) => a - b)
    const cadaDias = saltos[Math.floor(saltos.length / 2)]
    const haceDias = hoyDia - dias[dias.length - 1]
    if (cadaDias >= 3 && haceDias >= Math.round(cadaDias * 0.9)) out.push({ producto_id, cadaDias, haceDias })
  }
  return out.sort((a, b) => b.haceDias / b.cadaDias - a.haceDias / a.cadaDias)
}
