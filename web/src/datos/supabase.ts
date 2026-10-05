import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const clavePublica = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

export const supabaseConfigurado = Boolean(url && clavePublica)

/**
 * Cliente fijo a una sesión: manda siempre el token que se le dio, aunque el cliente global cambie de cuenta mientras
 * tanto. Una sincronización lo usa para que sus envíos y descargas no pasen a otra cuenta a medias.
 */
export function clienteDeCuenta(tokenDeAcceso: string): SupabaseClient | null {
  if (!supabaseConfigurado) return null
  return createClient(url, clavePublica, {
    global: { headers: { Authorization: `Bearer ${tokenDeAcceso}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** La clave pública no es un secreto: las políticas RLS deben proteger todas las tablas. */
export const supabase = supabaseConfigurado
  ? createClient(url, clavePublica, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
