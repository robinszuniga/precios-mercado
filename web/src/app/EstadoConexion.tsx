import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useMeta } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { supabase } from '../datos/supabase.ts'
import { reenviarRechazados, reintentarAhora, type EstadoSync } from '../datos/sync.ts'

function useEnLinea() {
  const [en, setEn] = useState(() => navigator.onLine)
  useEffect(() => {
    const a = () => setEn(true)
    const b = () => setEn(false)
    window.addEventListener('online', a)
    window.addEventListener('offline', b)
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b) }
  }, [])
  return en
}

/** Cuánto puede esperar un cambio en la cola antes de avisar que no está saliendo. */
export const ESPERA_COLA_MS = 15_000
const ERROR_DE_RED = /fetch|network|abort|timeout|señal|JSON|no es JSON|desconocid/i

/** El error de la nube en palabras de persona; si no es uno conocido, el texto original, recortado. */
export function explicarError(error: string, maximo = 90): string {
  if (/schema cache|does not exist|42P01|PGRST20[45]/i.test(error)) return 'a tu base en la nube le faltan tablas o columnas (migraciones sin aplicar)'
  if (/sesión|JWT|\b401\b|42501|row-level security|permission denied/i.test(error)) return 'tu sesión venció o no tiene acceso a tus datos: vuelve a entrar'
  const limpio = error.replace(/^Error:\s*/, '').trim()
  return limpio.length > maximo ? `${limpio.slice(0, maximo)}…` : limpio
}

/**
 * La causa para la pastilla de abajo, que es chica: lo conocido en palabras de persona y, de los rechazos de datos (que llegan
 * en inglés y con nombres de tablas), solo que la nube no los aceptó. El detalle completo se ve en la franja roja y en Ajustes.
 */
export function causaCorta(error: string): string {
  // Frases cortas: la pastilla es de 2 líneas y recorta lo que sobre, que sería justo lo que dice qué hacer.
  if (/schema cache|does not exist|42P01|PGRST20[45]/i.test(error)) return 'faltan migraciones en tu nube'
  if (/sesión|JWT|\b401\b|42501|row-level security|permission denied/i.test(error)) return 'tu sesión venció: vuelve a entrar'
  if (/violates (check|foreign key|not-null|unique)|null value in column|invalid input syntax|out of range/i.test(error)) return 'la nube no aceptó algunos datos (revisa Ajustes)'
  return explicarError(error, 70)
}

export function EstadoConexion() {
  const enLinea = useEnLinea()
  const pendientes = useLiveQuery(() => db.outbox.count(), []) ?? 0
  const sync = useMeta<EstadoSync>('estadoSync', { enCurso: false, ultimoOk: null, error: null })
  const sinBackend = !supabase
  // "Señal fantasma": el celular dice que hay conexión pero lo enviado no sale. Si lo más viejo de la cola lleva más de
  // 15 segundos sin salir, se avisa.
  const primero = useLiveQuery(async () => {
    const e = await db.outbox.orderBy('seq').first()
    return e ? { creado: e.creado, error: e.error ?? null } : null
  }, [])
  const masViejo = primero?.creado ?? null
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 5000); return () => clearInterval(t) }, [])
  // Una sincronización en marcha (por ejemplo la primera, con muchos cambios juntos) no es una señal fantasma.
  // Una ronda en marcha no es una señal fantasma… salvo que la anterior ya haya dejado un error: ahí la pastilla se queda (si
  // desapareciera y apareciera la franja roja, el contenido saltaría ~80 px en cada reintento y el botón se iría bajo el dedo).
  const sinSalir = masViejo != null && ahora - masViejo > ESPERA_COLA_MS && (!sync.enCurso || !!sync.error)
  // La señal va y viene en el súper: ese aviso flota abajo a la izquierda, sobre la barra, y no empuja la lista ni tapa el saldo (si la moviera,
  // un toque caería en el producto de al lado). Solo un error de verdad, que no parpadea, ocupa su franja.
  let pastilla: string | null = null
  if (!enLinea) pastilla = `Sin señal${pendientes ? ` · ${pendientes} por enviar` : ''}`
  else if ((sync.error && ERROR_DE_RED.test(sync.error)) || (sinSalir && primero?.error && ERROR_DE_RED.test(primero.error))) pastilla = 'Señal inestable · se envía solo'
  // Si no sale por otra causa, la causa va a la vista: no basta con decir que la nube "no responde". El error del propio envío
  // sirve cuando el aviso general ya se borró (una ronda que no tenía nada listo termina "bien" con la cola esperando).
  const reintentable = pastilla === null && sinSalir
  if (reintentable) {
    const causa = sync.error ?? primero?.error ?? null
    pastilla = `${pendientes} por enviar · ${causa ? causaCorta(causa) : 'sin respuesta de la nube'}`
  }
  // La pastilla con causa es alta y flota sobre las últimas filas: la pantalla reserva ese alto abajo (`--pastilla`) para que
  // se puedan subir por encima de ella.
  useEffect(() => {
    if (!reintentable || sinBackend) return
    document.documentElement.style.setProperty('--pastilla', '5rem')
    return () => { document.documentElement.style.removeProperty('--pastilla') }
  }, [reintentable, sinBackend])
  if (sinBackend) return null
  if (pastilla) {
    return (
      <div
        role="status"
        className="fixed left-3 z-30 flex max-w-[calc(100vw-6rem)] items-center rounded-2xl bg-stone-800/90 text-xs font-medium text-white shadow"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 4.25rem + var(--barra-acciones, 0rem))' }}
      >
        <a href="#/ajustes" title={pastilla} className={`min-w-0 pl-3 pr-2 ${reintentable ? 'flex min-h-11 items-center' : 'py-1.5'}`}>
          <span className={reintentable ? 'line-clamp-2' : undefined}>{pastilla}</span>
        </a>
        {reintentable && (
          <button type="button" className="min-h-11 shrink-0 px-3 font-semibold underline" onClick={() => void reintentarAhora()}>Reintentar</button>
        )}
      </div>
    )
  }
  if (!sync.error) return null
  // Cambios que el servidor rechazó: un toque los reenvía (si falta algo de lo que dependían, primero se vuelve a subir).
  const rechazos = /no fue(ron)? aceptados?/.test(sync.error)
  return (
    <div role="status" className="bg-red-100 px-4 py-3 text-center text-sm text-red-900">
      <a href="#/ajustes" className="block min-h-11">No se pudo sincronizar: {explicarError(sync.error, 260)}</a>
      {rechazos && <button type="button" className="min-h-11 px-3 font-semibold underline" onClick={() => void reenviarRechazados()}>Reenviar los rechazados</button>}
    </div>
  )
}
