export interface RegionVtex {
  /** Opaco: puede ser v1 (base64 "SW#...") o v2 ("v2.xxx"). Nunca se interpreta ni se escribe a mano. */
  regionId: string | null
  sellers: string[]
}

/** Respuesta de /api/checkout/pub/regions: [{ id, sellers: [{ id, name }] }]. */
export function parseRegiones(status: number, cuerpo: string): RegionVtex | null {
  if (status < 200 || status >= 300) return null
  let datos: unknown
  try { datos = JSON.parse(cuerpo) } catch { return null }
  if (!Array.isArray(datos)) return null
  const r = datos[0] as { id?: unknown; sellers?: unknown } | undefined
  if (!r) return { regionId: null, sellers: [] }
  const sellers = Array.isArray(r.sellers)
    ? r.sellers.map((s) => (s && typeof s === 'object' ? String((s as { id?: unknown }).id ?? '') : '')).filter(Boolean)
    : []
  return { regionId: typeof r.id === 'string' && r.id ? r.id : null, sellers }
}

/** La región trae al menos un seller. No basta para decir que la tienda atiende la ciudad: ver esLocal. */
export function estaLocalizada(r: RegionVtex | null): boolean {
  return !!r && !!r.regionId && r.sellers.length > 0
}

/**
 * Ciudad de referencia para descartar sellers genéricos. Medido el 27-sep-2026: por código postal Éxito y D1
 * devuelven la misma región genérica para cualquier ciudad y Olímpica ninguna; por coordenadas sí se distinguen.
 * D1 le asigna a Riohacha solo un seller que también aparece en Bogotá, Medellín y Barranquilla.
 */
export const REFERENCIA = { lon: -74.0721, lat: 4.711 } // Bogotá

/**
 * La tienda atiende la ciudad si su región (por coordenadas) trae algún seller propio, que no aparezca también
 * en la ciudad de referencia. Si solo trae sellers genéricos, el precio es el nacional.
 */
export function esLocal(ciudad: RegionVtex | null, referencia: RegionVtex | null): boolean {
  if (!estaLocalizada(ciudad)) return false
  // Sin la referencia (falló la consulta) no se puede saber si los sellers son genéricos: mejor precio nacional
  // que marcar como "de Riohacha" un precio que no lo es (y guardarlo así 7 días).
  if (!referencia) return false
  const ajenos = new Set(referencia?.sellers ?? [])
  return ciudad!.sellers.some((s) => !ajenos.has(s))
}
