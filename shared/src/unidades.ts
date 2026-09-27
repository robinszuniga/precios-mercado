import { formatoNumero, NBSP } from './dinero.ts'

export type UnidadBase = 'g' | 'ml' | 'unidad'

/** Cuántas unidades base tiene la unidad que ve el usuario: kg = 1000 g, L = 1000 ml. */
export function factorVisible(u: UnidadBase): number {
  return u === 'unidad' ? 1 : 1000
}

export function etiquetaVisible(u: UnidadBase): string {
  return u === 'g' ? 'kg' : u === 'ml' ? 'L' : 'und'
}

export function etiquetaPorUnidad(u: UnidadBase): string {
  return `$/${etiquetaVisible(u)}`
}

/** Precio por kg, L o unidad. null si no se conoce el contenido. */
export function precioPorUnidad(precio: number | null, contenido: number | null, u: UnidadBase): number | null {
  if (precio == null || !(precio > 0)) return null
  if (contenido == null || !(contenido > 0)) return null
  return (precio / contenido) * factorVisible(u)
}

export function esUnidadBase(v: unknown): v is UnidadBase {
  return v === 'g' || v === 'ml' || v === 'unidad'
}

/** Contenido legible: 500 → "500 g", 1100 ml → "1,1 L", 30 → "30 und". */
export function formatoContenido(contenido: number, u: UnidadBase): string {
  if (u === 'unidad') return `${formatoNumero(contenido)}${NBSP}und`
  const f = factorVisible(u)
  if (contenido >= f) return `${formatoNumero(contenido / f)}${NBSP}${etiquetaVisible(u)}`
  return `${formatoNumero(contenido)}${NBSP}${u}`
}

/** Cantidad en la unidad que ve el usuario: 2,5 kg · 6 L · 30 und. */
export function formatoCantidadVisible(cantidad: number, u: UnidadBase): string {
  return `${formatoNumero(cantidad)}${NBSP}${etiquetaVisible(u)}`
}
