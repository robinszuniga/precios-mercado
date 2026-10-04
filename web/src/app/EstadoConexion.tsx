import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useMeta } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { supabase } from '../datos/supabase.ts'
import type { EstadoSync } from '../datos/sync.ts'

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

export function EstadoConexion() {
  const enLinea = useEnLinea()
  const pendientes = useLiveQuery(() => db.outbox.count(), []) ?? 0
  const sync = useMeta<EstadoSync>('estadoSync', { enCurso: false, ultimoOk: null, error: null })
  const sinBackend = !supabase
  // "Señal fantasma": el celular dice que hay conexión pero lo enviado no sale. Si lo más viejo de la cola lleva más de
  // 15 segundos sin salir, se avisa.
  const masViejo = useLiveQuery(async () => (await db.outbox.orderBy('seq').first())?.creado ?? null, [])
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 5000); return () => clearInterval(t) }, [])
  // Una sincronización en marcha (por ejemplo la primera, con muchos cambios juntos) no es una señal fantasma.
  const sinSalir = masViejo != null && ahora - masViejo > ESPERA_COLA_MS && !sync.enCurso
  if (sinBackend) return null
  // La señal va y viene en el súper: ese aviso flota abajo a la izquierda, sobre la barra, y no empuja la lista ni tapa el saldo (si la moviera,
  // un toque caería en el producto de al lado). Solo un error de verdad, que no parpadea, ocupa su franja.
  let pastilla: string | null = null
  if (!enLinea) pastilla = `Sin señal${pendientes ? ` · ${pendientes} por enviar` : ''}`
  else if (sync.error && ERROR_DE_RED.test(sync.error)) pastilla = 'Señal inestable · se envía solo'
  else if (sinSalir) pastilla = `${pendientes} por enviar · sin respuesta de la nube`
  if (pastilla) {
    return (
      <a
        href="#/ajustes"
        role="status"
        className="fixed left-3 z-30 rounded-full bg-stone-800/90 px-3 py-1.5 text-xs font-medium text-white shadow"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 4.25rem + var(--barra-acciones, 0rem))' }}
      >
        {pastilla}
      </a>
    )
  }
  if (!sync.error) return null
  return (
    <div role="status">
      <a href="#/ajustes" className="block min-h-11 bg-red-100 px-4 py-3 text-center text-sm text-red-900">No se pudo sincronizar: {sync.error}</a>
    </div>
  )
}
