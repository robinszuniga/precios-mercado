// Colombia no tiene horario de verano: el desfase es siempre -05:00.
const DESFASE_MS = -5 * 60 * 60 * 1000
const DIA_MS = 24 * 60 * 60 * 1000

/** ISO con milisegundos y -05:00. Al tener siempre el mismo largo y desfase, se compara como texto. */
export function isoBogota(ms: number): string {
  const local = new Date(ms + DESFASE_MS).toISOString() // "YYYY-MM-DDTHH:mm:ss.sssZ" en hora de Bogotá
  return local.slice(0, 23) + '-05:00'
}

/** "YYYY-MM-DD" del día en Bogotá. */
export function diaBogota(iso: string): string {
  return isoBogota(aMs(iso)).slice(0, 10)
}

export function aMs(iso: string): number {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`Fecha inválida: ${iso}`)
  return ms
}

export function esIso(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v))
}

/** Días completos entre dos fechas. Una fecha futura (reloj desfasado) cuenta como 0. */
export function diasEntre(desde: string, hasta: string): number {
  const d = Math.floor((aMs(hasta) - aMs(desde)) / DIA_MS)
  return d < 0 ? 0 : d
}

export function sumarSegundos(iso: string, segundos: number): string {
  return isoBogota(aMs(iso) + segundos * 1000)
}

/** Compara dos ISO aunque tengan distinto desfase. */
export function compararIso(a: string, b: string): number {
  return aMs(a) - aMs(b)
}
