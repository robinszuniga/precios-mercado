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
