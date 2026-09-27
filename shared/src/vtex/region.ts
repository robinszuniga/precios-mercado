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

/** La tienda atiende la ubicación cuando la región trae al menos un seller. */
export function estaLocalizada(r: RegionVtex | null): boolean {
  return !!r && !!r.regionId && r.sellers.length > 0
}
