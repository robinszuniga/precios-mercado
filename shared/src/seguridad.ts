import { COLUMNAS_OPCIONALES, TABLAS, type NombreTabla, type TipoCol } from './esquema.ts'
import { esIso } from './fechas.ts'

/** Un texto que empieza por = + - @ se volvería fórmula en Sheets; se le antepone un apóstrofo. */
export function escaparFormula(v: string): string {
  return /^[=+\-@]/.test(v) ? `'${v}` : v
}

export function quitarEscape(v: string): string {
  return v.startsWith("'") && /^'[=+\-@]/.test(v) ? v.slice(1) : v
}

export type Fila = Record<string, unknown>

/** Una celda de Sheets aguanta 50.000 caracteres: un texto más largo haría fallar la escritura de toda la tabla. */
export const MAX_TEXTO = 2000

function coercer(valor: unknown, tipo: TipoCol): { ok: true; v: string | number | boolean | null } | { ok: false } {
  if (valor === undefined || valor === null || valor === '') return { ok: true, v: tipo === 'b' ? false : tipo === 'n' ? null : '' }
  if (tipo === 't') return typeof valor === 'string' || typeof valor === 'number' ? { ok: true, v: String(valor) } : { ok: false }
  if (tipo === 'n') {
    const n = typeof valor === 'number' ? valor : typeof valor === 'string' ? Number(valor) : NaN
    return Number.isFinite(n) ? { ok: true, v: n } : { ok: false }
  }
  if (typeof valor === 'boolean') return { ok: true, v: valor }
  if (valor === 'TRUE' || valor === 'true') return { ok: true, v: true }
  if (valor === 'FALSE' || valor === 'false') return { ok: true, v: false }
  return { ok: false }
}

export type Validacion = { ok: true; fila: Fila } | { ok: false; error: string }

/**
 * Deja solo las columnas conocidas con su tipo. Para las tablas que escribe el cliente exige id y updated_at ISO.
 * Las columnas que el servidor controla (_srv) se descartan.
 */
export function validarFila(tabla: NombreTabla, fila: unknown, deCliente = true): Validacion {
  const def = TABLAS[tabla]
  if (!fila || typeof fila !== 'object' || Array.isArray(fila)) return { ok: false, error: 'fila no es un objeto' }
  if (deCliente && !def.cliente) return { ok: false, error: `la tabla ${tabla} no se puede escribir` }
  const f = fila as Fila
  const salida: Fila = {}
  const opcionales = COLUMNAS_OPCIONALES[tabla] ?? []
  for (const [col, tipo] of Object.entries(def.cols) as [string, TipoCol][]) {
    if (col === '_srv') continue
    // Un cliente viejo no manda las columnas nuevas: sin la clave no se toca lo que ya hay.
    if (deCliente && f[col] === undefined && opcionales.includes(col)) continue
    const c = coercer(f[col], tipo)
    if (!c.ok) return { ok: false, error: `columna ${col}: valor inválido` }
    salida[col] = typeof c.v === 'string' ? escaparFormula(c.v.slice(0, MAX_TEXTO)) : c.v
  }
  const id = salida[def.id]
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) return { ok: false, error: `falta ${def.id}` }
  if ('updated_at' in def.cols && !esIso(salida.updated_at)) return { ok: false, error: 'updated_at inválido' }
  return { ok: true, fila: salida }
}
