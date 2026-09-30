import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useMeta } from '../datos/consultas.ts'
import { db, guardarMeta } from '../datos/db.ts'
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

const DIAS_AVISO_SIN_COPIA = 14
/** Cuánto puede esperar un cambio en la cola antes de avisar que no está saliendo. */
export const ESPERA_COLA_MS = 15_000
const ERROR_DE_RED = /fetch|network|abort|timeout|señal|JSON|no es JSON|desconocid/i

export function EstadoConexion() {
  const enLinea = useEnLinea()
  const pendientes = useLiveQuery(() => db.outbox.count(), []) ?? 0
  const conexion = useMeta<{ url: string; token: string }>('conexion', { url: '', token: '' })
  const sync = useMeta<EstadoSync>('estadoSync', { enCurso: false, ultimoOk: null, error: null })
  const cerradoEl = useMeta<number | null>('avisoSinCopiaCerrado', null)
  const sinBackend = !conexion.url || !conexion.token
  // "Señal fantasma": el celular dice que hay conexión pero lo enviado no sale. Si lo más viejo de la cola lleva más de
  // 15 segundos sin salir, se avisa (sin eso, la persona cree que se guardó en Google y no).
  const masViejo = useLiveQuery(async () => (await db.outbox.orderBy('seq').first())?.creado ?? null, [])
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 5000); return () => clearInterval(t) }, [])
  const sinSalir = masViejo != null && ahora - masViejo > ESPERA_COLA_MS
  // La copia en Google es opcional: no se ofrece hasta que hay algo que cuidar (una compra cerrada).
  const hayQueCuidar = (useLiveQuery(() => db.compras.where('estado').equals('cerrada').count(), []) ?? 0) > 0

  if (sinBackend) {
    if (!hayQueCuidar || (cerradoEl && Date.now() - cerradoEl < DIAS_AVISO_SIN_COPIA * 86400000)) return null
    return (
      <div role="status" className="flex items-center justify-between gap-2 bg-stone-100 px-4 text-sm text-stone-800">
        <a href="#/ajustes" className="min-h-11 flex-1 py-3">Opcional: guarda una copia de tus datos en tu cuenta de Google · <span className="font-semibold underline">Ver cómo</span></a>
        <button type="button" aria-label="Cerrar aviso" className="grid size-11 place-items-center text-lg" onClick={() => void guardarMeta('avisoSinCopiaCerrado', Date.now())}>×</button>
      </div>
    )
  }
  // La señal va y viene en el súper: ese aviso flota abajo a la izquierda, sobre la barra, y no empuja la lista ni tapa el saldo (si la moviera,
  // un toque caería en el producto de al lado). Solo un error de verdad, que no parpadea, ocupa su franja.
  let pastilla: string | null = null
  if (!enLinea) pastilla = `Sin señal${pendientes ? ` · ${pendientes} por enviar` : ''}`
  else if (sync.error && ERROR_DE_RED.test(sync.error)) pastilla = 'Señal inestable · se envía solo'
  else if (sinSalir) pastilla = `${pendientes} por enviar · sin respuesta de Google`
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
