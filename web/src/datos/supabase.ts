import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const clavePublica = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

export const supabaseConfigurado = Boolean(url && clavePublica)

/** La clave pública no es un secreto: las políticas RLS deben proteger todas las tablas. */
export const supabase = supabaseConfigurado
  ? createClient(url, clavePublica, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
