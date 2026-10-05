import { Fragment, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { db, invalidarCuenta, usarBaseLocal } from '../datos/db.ts'
import { arrancarSincronizacion, esperarSincronizacion } from '../datos/sync.ts'
import { supabase, supabaseConfigurado } from '../datos/supabase.ts'

/**
 * El estado del cambio de cuenta es del módulo, no del efecto. En desarrollo React monta el componente dos veces: si cada
 * montaje tuviera su propia cola y su propia "cuenta actual", cada uno cerraría la base local que abrió el otro
 * ("DatabaseClosedError") y la app no abriría.
 */
let cuentaActual: string | null | undefined
let limpiezaSync: (() => void) | undefined
let colaCambio: Promise<void> = Promise.resolve()

export function Acceso({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null)
  const [preparado, setPreparado] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    let viva = true
    const cambiarCuenta = (s: Session | null) => {
      const turno = colaCambio.then(async () => {
        const id = s?.user.id ?? null
        if (cuentaActual !== id) {
          // Desde aquí, lo que siga corriendo de la cuenta anterior (sincronización, búsqueda de precios) se descarta,
          // y la app se desmonta ya: no queda nada de la cuenta anterior en pantalla mientras cambia la base local.
          invalidarCuenta()
          if (viva) setPreparado(false)
          limpiezaSync?.()
          limpiezaSync = undefined
          await esperarSincronizacion()
          // El servicio de Apps Script quedó obsoleto para la app con Supabase; quita URL y token locales antiguos.
          await db.meta.bulkDelete(['conexion', 'scriptInfo', 'proyectoConectado'])
          await db.close()
          usarBaseLocal(id)
          await db.meta.bulkDelete(['conexion', 'scriptInfo', 'proyectoConectado'])
          cuentaActual = id
          if (s) limpiezaSync = arrancarSincronizacion()
        }
        if (viva) {
          setSesion(s)
          setPreparado(true)
        }
      })
      // Un fallo de un turno no debe dejar la cola rechazada para siempre: los turnos siguientes tienen que poder correr.
      colaCambio = turno.catch(() => undefined)
      return turno
    }
    const { data: listener } = supabase.auth.onAuthStateChange((_evento, s) => {
      // Supabase exige que los callbacks de auth sean rápidos. El trabajo de IndexedDB va fuera del callback.
      queueMicrotask(() => {
        cambiarCuenta(s).catch((e: unknown) => {
          if (viva) { setError(e instanceof Error ? e.message : 'No se pudo cambiar de cuenta.'); setPreparado(true) }
        })
      })
    })
    void supabase.auth.getSession().then(({ data, error: e }) => {
      if (e) setError(e.message)
      return cambiarCuenta(data.session)
    }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión.')
      setPreparado(true)
    })
    return () => {
      viva = false
      limpiezaSync?.()
      limpiezaSync = undefined
      // Un montaje nuevo vuelve a preparar la cuenta (y a arrancar la sincronización que acaba de detenerse).
      cuentaActual = undefined
      listener.subscription.unsubscribe()
    }
  }, [])

  async function entrar() {
    if (!supabase) return
    setError('')
    setOcupado(true)
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href.split('#')[0] },
    })
    if (e) { setError(e.message); setOcupado(false) }
  }

  async function salir() {
    if (!supabase) return
    setOcupado(true)
    const { error: e } = await supabase.auth.signOut()
    if (e) setError(e.message)
    setOcupado(false)
  }

  if (!supabaseConfigurado || !supabase) {
    return <PantallaAcceso titulo="Falta conectar la base segura" detalle="La app aún no está configurada para iniciar sesión. No se cargaron datos ni se usó la hoja compartida." />
  }
  if (!preparado) return <PantallaAcceso titulo="Conectando…" detalle="Estamos comprobando tu sesión." />
  if (sesion && ocupado) return <PantallaAcceso titulo="Cerrando sesión…" detalle="Estamos terminando la sincronización y cerrando tu cuenta en este dispositivo." />
  if (!sesion) {
    return (
      <PantallaAcceso titulo="Precios de Mercado" detalle="Inicia sesión para guardar tus productos y compras en tu propia cuenta.">
        <button type="button" onClick={() => void entrar()} disabled={ocupado} className="mt-6 min-h-12 w-full rounded-xl bg-marca px-4 font-semibold text-white disabled:opacity-60">
          {ocupado ? 'Abriendo Google…' : 'Continuar con Google'}
        </button>
        {error && <p role="alert" className="mt-3 text-sm text-peligro">No se pudo iniciar sesión: {error}</p>}
        <p className="mt-4 text-xs text-stone-500">Cada cuenta solo puede consultar y cambiar sus propios datos.</p>
      </PantallaAcceso>
    )
  }
  return (
    <>
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 pt-2 text-xs text-stone-600">
        <span className="min-w-0 truncate">Cuenta: {sesion.user.email ?? 'Google'}</span>
        <button type="button" onClick={() => void salir()} disabled={ocupado} className="min-h-11 shrink-0 px-2 font-medium text-marca underline">Cerrar sesión</button>
      </div>
      {error && <p role="alert" className="mx-auto max-w-lg px-4 text-sm text-peligro">No se pudo cerrar sesión: {error}</p>}
      {/* Con la cuenta como llave, al cambiar de cuenta la app se monta de cero: no quedan formularios ni selecciones de la anterior. */}
      <Fragment key={sesion.user.id}>{children}</Fragment>
    </>
  )
}

function PantallaAcceso({ titulo, detalle, children }: { titulo: string; detalle: string; children?: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-stone-50 px-5 py-10 text-stone-900">
      <section className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
        <div className="mb-4 grid size-12 place-items-center rounded-full bg-marca-suave text-marca" aria-hidden="true">🛒</div>
        <h1 className="text-xl font-semibold">{titulo}</h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">{detalle}</p>
        {children}
      </section>
    </main>
  )
}
