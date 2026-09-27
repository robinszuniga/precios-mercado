import type { PrecioActual, Presentacion } from './esquema.ts'
import { precioEfectivo, type EvaluacionPrecio, type PrecioEfectivo, type Vigencias } from './precioEfectivo.ts'
import type { Tienda } from './tiendas.ts'
import { factorVisible, precioPorUnidad, type UnidadBase } from './unidades.ts'

export interface Opcion {
  tienda: Tienda
  presentacion: Presentacion
  efectivo: PrecioEfectivo
  /** $/kg, $/L o $/und. null si la presentación no tiene contenido. */
  precioUnidad: number | null
}

export interface OpcionesProducto {
  /** La mejor presentación con precio vigente en cada tienda. */
  porTienda: Partial<Record<Tienda, Opcion>>
  /** Para mostrar en gris cuando no hay nada vigente. */
  sinVigente: Partial<Record<Tienda, EvaluacionPrecio>>
  mejor: Opcion | null
}

function mejorQue(a: Opcion, b: Opcion): boolean {
  if (a.precioUnidad != null && b.precioUnidad != null && a.precioUnidad !== b.precioUnidad) return a.precioUnidad < b.precioUnidad
  if (a.precioUnidad != null && b.precioUnidad == null) return true
  if (a.precioUnidad == null && b.precioUnidad != null) return false
  if (a.efectivo.precio !== b.efectivo.precio) return a.efectivo.precio < b.efectivo.precio
  return a.efectivo.fecha > b.efectivo.fecha
}

/** Compara las presentaciones de un producto en cada tienda por precio por unidad. */
export function opcionesProducto(
  presentaciones: readonly Presentacion[],
  actualesPorPresentacion: ReadonlyMap<string, PrecioActual[]>,
  unidad: UnidadBase,
  vig: Vigencias,
  ahora: string,
  tiendas?: readonly Tienda[],
): OpcionesProducto {
  const porTienda: Partial<Record<Tienda, Opcion>> = {}
  const sinVigente: Partial<Record<Tienda, EvaluacionPrecio>> = {}
  for (const p of presentaciones) {
    if (!p.activo) continue
    if (tiendas && !tiendas.includes(p.tienda)) continue
    const ev = precioEfectivo(actualesPorPresentacion.get(p.presentacion_id) ?? [], vig, ahora)
    if (!ev.efectivo) {
      if (!porTienda[p.tienda] && (!sinVigente[p.tienda] || (ev.ultimo && !sinVigente[p.tienda]!.ultimo))) sinVigente[p.tienda] = ev
      continue
    }
    const op: Opcion = {
      tienda: p.tienda,
      presentacion: p,
      efectivo: ev.efectivo,
      precioUnidad: precioPorUnidad(ev.efectivo.precio, p.contenido, unidad),
    }
    const actual = porTienda[p.tienda]
    if (!actual || mejorQue(op, actual)) porTienda[p.tienda] = op
    delete sinVigente[p.tienda]
  }
  let mejor: Opcion | null = null
  for (const op of Object.values(porTienda)) {
    if (op.precioUnidad == null) continue
    if (!mejor || mejorQue(op, mejor)) mejor = op
  }
  // Si nadie tiene contenido, solo se puede comparar cuando hay una única opción.
  if (!mejor) {
    const ops = Object.values(porTienda)
    if (ops.length === 1) mejor = ops[0]
  }
  return { porTienda, sinVigente, mejor }
}

// ---------- Costo de un ítem de la lista en una tienda ----------

export interface CostoEnTienda {
  opcion: Opcion
  /** Paquetes sugeridos (kg/L si es granel). */
  paquetes: number
  /** Lo que se pagaría de verdad: paquetes × precio del paquete. */
  costoReal: number
  /** Necesidad × precio por unidad: lo justo para comparar tiendas con tamaños distintos. */
  costoEquivalente: number
}

/** necesidad va en kg, L o unidades (lo que ve el usuario). */
export function costoEnTienda(op: Opcion, necesidad: number, unidad: UnidadBase): CostoEnTienda {
  const base = necesidad * factorVisible(unidad)
  const contenido = op.presentacion.contenido
  let paquetes: number
  if (op.presentacion.granel || !contenido || !(contenido > 0)) {
    paquetes = op.presentacion.granel && contenido ? base / contenido : Math.max(1, Math.round(necesidad))
  } else {
    paquetes = Math.max(1, Math.round(base / contenido))
  }
  paquetes = Math.round(paquetes * 1000) / 1000
  const costoReal = paquetes * op.efectivo.precio
  const costoEquivalente = op.precioUnidad != null ? necesidad * op.precioUnidad : costoReal
  return { opcion: op, paquetes, costoReal, costoEquivalente }
}

// ---------- Plan de compra por conjunto de tiendas ----------

export interface ItemPlan {
  id: string
  /** Costo en cada tienda donde hay precio vigente. */
  costos: Partial<Record<Tienda, CostoEnTienda>>
  /** El usuario fijó la tienda para este ítem. */
  fijo?: Tienda
}

export interface GrupoTienda {
  tienda: Tienda
  items: { id: string; costo: CostoEnTienda }[]
  total: number
}

export interface TodoEn {
  tienda: Tienda
  total: number
  items: number
  de: number
}

export interface Plan {
  tiendas: Tienda[]
  grupos: GrupoTienda[]
  sinPrecio: string[]
  total: number
  /** Si se comprara todo en una sola tienda (solo lo que esa tienda tiene). */
  todoEn: TodoEn[]
  /** Tienda única más barata que tiene todo, si existe. */
  mejorUnica: TodoEn | null
  /** Cuánto ahorra el plan frente a la mejor tienda única completa. */
  ahorro: number | null
}

function subconjuntos<T>(xs: readonly T[]): T[][] {
  const res: T[][] = []
  for (let m = 1; m < 1 << xs.length; m++) res.push(xs.filter((_, i) => m & (1 << i)))
  return res
}

/**
 * Prueba todos los grupos de tiendas de hoy (máximo 15 con 4 tiendas). Cada tienda extra cuesta
 * `ahorroMinimo` (el viaje), así solo se recomienda ir a otra tienda si el ahorro lo justifica.
 * Gana la mayor cobertura; luego el menor costo; luego menos tiendas.
 */
export function planCompra(items: readonly ItemPlan[], tiendasHoy: readonly Tienda[], ahorroMinimo: number): Plan {
  const fijas = [...new Set(items.map((i) => i.fijo).filter((t): t is Tienda => !!t))]
  const candidatos = tiendasHoy.length ? subconjuntos(tiendasHoy) : [[]]
  const vistos = new Set<string>()
  let mejor: { tiendas: Tienda[]; asignacion: Map<string, Tienda>; cobertura: number; costo: number; total: number } | null = null

  for (const sub of candidatos) {
    const tiendas = [...new Set([...sub, ...fijas])]
    const clave = [...tiendas].sort().join(',')
    if (vistos.has(clave)) continue
    vistos.add(clave)
    const asignacion = new Map<string, Tienda>()
    let total = 0
    for (const it of items) {
      if (it.fijo) {
        const c = it.costos[it.fijo]
        asignacion.set(it.id, it.fijo)
        if (c) total += c.costoReal
        continue
      }
      let elegida: Tienda | null = null
      for (const t of tiendas) {
        const c = it.costos[t]
        if (!c) continue
        if (!elegida || c.costoEquivalente < it.costos[elegida]!.costoEquivalente) elegida = t
      }
      if (elegida) {
        asignacion.set(it.id, elegida)
        total += it.costos[elegida]!.costoReal
      }
    }
    const usadas = new Set(asignacion.values())
    const cobertura = items.filter((i) => asignacion.has(i.id) && i.costos[asignacion.get(i.id)!]).length
    const costo = total + ahorroMinimo * Math.max(0, usadas.size - 1)
    const mejorEs =
      !mejor ||
      cobertura > mejor.cobertura ||
      (cobertura === mejor.cobertura && costo < mejor.costo) ||
      (cobertura === mejor.cobertura && costo === mejor.costo && usadas.size < new Set(mejor.asignacion.values()).size)
    if (mejorEs) mejor = { tiendas: [...usadas], asignacion, cobertura, costo, total }
  }

  const grupos: GrupoTienda[] = []
  const sinPrecio: string[] = []
  for (const it of items) {
    const t = mejor?.asignacion.get(it.id)
    const c = t ? it.costos[t] : undefined
    if (!t || !c) { sinPrecio.push(it.id); continue }
    let g = grupos.find((x) => x.tienda === t)
    if (!g) { g = { tienda: t, items: [], total: 0 }; grupos.push(g) }
    g.items.push({ id: it.id, costo: c })
    g.total += c.costoReal
  }

  const todoEn: TodoEn[] = tiendasHoy.map((t) => {
    const con = items.filter((i) => i.costos[t])
    return { tienda: t, total: con.reduce((s, i) => s + i.costos[t]!.costoReal, 0), items: con.length, de: items.length }
  })
  const completas = todoEn.filter((x) => x.items === x.de && x.de > 0).sort((a, b) => a.total - b.total)
  const mejorUnica = completas[0] ?? null
  const total = grupos.reduce((s, g) => s + g.total, 0)
  const ahorro = mejorUnica && sinPrecio.length === 0 ? mejorUnica.total - total : null

  return { tiendas: grupos.map((g) => g.tienda), grupos, sinPrecio, total, todoEn, mejorUnica, ahorro }
}
