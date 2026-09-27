import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { Avisos } from '../componentes/ui.tsx'
import { useMeta } from '../datos/consultas.ts'
import { db, guardarMeta } from '../datos/db.ts'
import { compraAbierta } from '../datos/escritura.ts'
import type { EstadoSync } from '../datos/sync.ts'
import { Ajustes } from '../pantallas/Ajustes.tsx'
import { Compra } from '../pantallas/Compra.tsx'
import { Historico } from '../pantallas/Historico.tsx'
import { Lista } from '../pantallas/Lista.tsx'
import { Plan } from '../pantallas/Plan.tsx'
import { DetalleProducto } from '../pantallas/Producto.tsx'
import { AvisoVersion } from './AvisoVersion.tsx'
import { useRuta, type Ruta } from './ruta.ts'

function Icono({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

const PESTANAS: { vista: Ruta['vista']; hash: string; texto: string; icono: ReactNode }[] = [
  { vista: 'lista', hash: '#/lista', texto: 'Productos', icono: <Icono><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17" /></Icono> },
  { vista: 'plan', hash: '#/plan', texto: 'Plan', icono: <Icono><path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></Icono> },
  { vista: 'compra', hash: '#/compra', texto: 'Compra', icono: <Icono><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.7 12.2a1 1 0 0 0 1 .8h9.6a1 1 0 0 0 1-.8L21 7H6.1" /></Icono> },
  { vista: 'historico', hash: '#/historico', texto: 'Historial', icono: <Icono><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /></Icono> },
  { vista: 'ajustes', hash: '#/ajustes', texto: 'Ajustes', icono: <Icono><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></Icono> },
]

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
const ERROR_DE_RED = /fetch|network|abort|timeout|señal|JSON|no es JSON|desconocid/i

function EstadoConexion() {
  const enLinea = useEnLinea()
  const pendientes = useLiveQuery(() => db.outbox.count(), []) ?? 0
  const conexion = useMeta<{ url: string; token: string }>('conexion', { url: '', token: '' })
  const sync = useMeta<EstadoSync>('estadoSync', { enCurso: false, ultimoOk: null, error: null })
  const cerradoEl = useMeta<number | null>('avisoSinCopiaCerrado', null)
  const sinBackend = !conexion.url || !conexion.token

  if (sinBackend) {
    if (cerradoEl && Date.now() - cerradoEl < DIAS_AVISO_SIN_COPIA * 86400000) return null
    return (
      <div role="status" className="flex items-center justify-between gap-2 bg-yellow-100 px-4 text-sm text-yellow-900">
        <a href="#/ajustes" className="min-h-11 flex-1 py-3">Tus datos solo están en este celular · <span className="font-semibold underline">Guardar copia en Google</span></a>
        <button type="button" aria-label="Cerrar aviso" className="grid size-11 place-items-center text-lg" onClick={() => void guardarMeta('avisoSinCopiaCerrado', Date.now())}>×</button>
      </div>
    )
  }
  let texto: string | null = null
  let color = 'bg-stone-200 text-stone-800'
  if (!enLinea) texto = `Sin señal${pendientes ? ` · ${pendientes} cambios guardados, se envían solos` : ''}`
  else if (sync.error && ERROR_DE_RED.test(sync.error)) texto = `Sin conexión estable · tus cambios están guardados y se enviarán solos`
  else if (sync.error) { texto = `No se pudo sincronizar: ${sync.error}`; color = 'bg-red-100 text-red-900' }
  else if (sync.enCurso && pendientes) texto = 'Guardando en Google…'
  if (!texto) return null
  return (
    <div role="status">
      <a href="#/ajustes" className={`block min-h-11 px-4 py-3 text-center text-sm ${color}`}>{texto}</a>
    </div>
  )
}

function usePendientesCompra(): number {
  return useLiveQuery(async () => {
    const c = await compraAbierta()
    if (!c || c.estado !== 'en_curso') return 0
    return (await db.detalle.where('compra_id').equals(c.compra_id).toArray()).filter((d) => !d.borrado && d.estado === 'pendiente').length
  }, []) ?? 0
}

export function App() {
  const ruta = useRuta()
  const pendientes = usePendientesCompra()
  return (
    <div className="mx-auto min-h-dvh max-w-lg">
      <EstadoConexion />
      <AvisoVersion />
      <main className="pb-seguro px-4 pt-4">
        {ruta.vista === 'lista' && <Lista />}
        {ruta.vista === 'producto' && <DetalleProducto id={ruta.id} />}
        {ruta.vista === 'plan' && <Plan />}
        {ruta.vista === 'compra' && <Compra />}
        {ruta.vista === 'historico' && <Historico productoId={ruta.productoId} compraId={ruta.compraId} />}
        {ruta.vista === 'ajustes' && <Ajustes />}
      </main>
      <Avisos />
      <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto flex max-w-lg">
          {PESTANAS.map((p) => {
            const activa = p.vista === ruta.vista || (p.vista === 'lista' && ruta.vista === 'producto')
            return (
              <a
                key={p.vista}
                href={p.hash}
                aria-current={activa ? 'page' : undefined}
                className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs ${activa ? 'font-semibold text-marca' : 'text-stone-600'}`}
              >
                <span className={`rounded-full px-4 py-0.5 ${activa ? 'bg-marca-suave' : ''}`}>{p.icono}</span>
                {p.texto}
                {p.vista === 'compra' && pendientes > 0 && (
                  <span className="absolute top-1 left-1/2 ml-2 min-w-5 rounded-full bg-marca px-1 text-center text-[11px] font-bold text-white" aria-label={`${pendientes} por comprar`}>
                    {pendientes}
                  </span>
                )}
              </a>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
