import { COLUMNAS_OPCIONALES, type NombreTabla } from './esquema.ts'
import { compararIso } from './fechas.ts'

/** Gana la versión con updated_at mayor. Si empatan, la remota (la del servidor). */
export function ganaRemoto(local: { updated_at: string } | undefined, remoto: { updated_at: string }): boolean {
  if (!local) return true
  return compararIso(remoto.updated_at, local.updated_at) >= 0
}

export function enLotes<T>(xs: readonly T[], tam: number): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < xs.length; i += tam) lotes.push(xs.slice(i, i + tam))
  return lotes
}

/**
 * Un servidor con un script viejo no guarda las columnas nuevas (marca) y las devuelve vacías o sin la clave, con el
 * mismo updated_at: sin esto el pull borraría en el celular lo que acaba de escribir. Si lo local tiene valor y lo
 * remoto no (y no es más nuevo), se conserva lo local y se avisa para volver a enviarlo.
 */
export function conservarOpcionales<F extends { updated_at: string }>(tabla: NombreTabla, local: { updated_at: string } | undefined, remoto: F): { fila: F; reenviar: boolean } {
  const cols = COLUMNAS_OPCIONALES[tabla] ?? []
  if (!local || !cols.length || compararIso(remoto.updated_at, local.updated_at) > 0) return { fila: remoto, reenviar: false }
  const l = local as Record<string, unknown>
  const r = remoto as Record<string, unknown>
  const fila: Record<string, unknown> = { ...r }
  let reenviar = false
  for (const c of cols) {
    const vacio = r[c] === undefined || r[c] === null || r[c] === ''
    if (vacio && l[c] !== undefined && l[c] !== null && l[c] !== '') { fila[c] = l[c]; reenviar = true }
  }
  return { fila: fila as F, reenviar }
}
