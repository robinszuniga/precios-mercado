import type { ResultadoApi } from './api.ts'
import { supabase } from './supabase.ts'

type Sobre<T> = { ok: boolean; data: T; error: { codigo: string; mensaje: string } | null }

/** Invoca la función de VTEX con la sesión Supabase del usuario, nunca con un token compartido de Google. */
export async function llamarVtex<T>(accion: string, params: Record<string, unknown> = {}, timeoutMs = 45_000): Promise<ResultadoApi<T>> {
  if (!supabase) return { tipo: 'error', codigo: 'sin_conexion', mensaje: 'La cuenta no está conectada.' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { tipo: 'desconocido', motivo: 'sin señal' }
  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    const resultado = await Promise.race([
      supabase.functions.invoke('vtex', { body: { a: accion, ...params } }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('La consulta tardó demasiado.')), timeoutMs) }),
    ]).finally(() => { if (timer) clearTimeout(timer) })
    const { data, error } = resultado
    if (error) {
      const response = (error as { context?: Response }).context
      if (response) {
        const body = await response.clone().json().catch(() => null) as Sobre<T> | null
        if (body?.error) return { tipo: 'error', codigo: body.error.codigo, mensaje: body.error.mensaje }
        if (response.status === 429) return { tipo: 'error', codigo: 'rate_limit', mensaje: 'Espera un minuto antes de volver a consultar precios.' }
      }
      return { tipo: 'desconocido', motivo: error.message || 'Sin respuesta del servicio de precios.' }
    }
    const sobre = data as Sobre<T> | null
    if (!sobre || typeof sobre !== 'object') return { tipo: 'desconocido', motivo: 'Respuesta inválida del servicio de precios.' }
    if (sobre.ok) return { tipo: 'ok', data: sobre.data }
    return { tipo: 'error', codigo: sobre.error?.codigo ?? 'interno', mensaje: sobre.error?.mensaje ?? 'No se pudo consultar precios.' }
  } catch (e) {
    return { tipo: 'desconocido', motivo: e instanceof Error ? e.message : String(e) }
  }
}
