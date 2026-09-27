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
