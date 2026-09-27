import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from '../datos/db.ts'
import { useMeta } from '../datos/consultas.ts'
import type { EstadoSync } from '../datos/sync.ts'
import { Ajustes } from '../pantallas/Ajustes.tsx'
import { Compra } from '../pantallas/Compra.tsx'
import { Historico } from '../pantallas/Historico.tsx'
import { Lista } from '../pantallas/Lista.tsx'
import { Plan } from '../pantallas/Plan.tsx'
import { DetalleProducto } from '../pantallas/Producto.tsx'
import { AvisoVersion } from './AvisoVersion.tsx'
import { useRuta, type Ruta } from './ruta.ts'

const PESTANAS: { vista: Ruta['vista']; hash: string; texto: string; icono: string }[] = [
  { vista: 'lista', hash: '#/lista', texto: 'Lista', icono: '☰' },
  { vista: 'plan', hash: '#/plan', texto: 'Plan', icono: '⇄' },
  { vista: 'compra', hash: '#/compra', texto: 'Compra', icono: '🛒' },
  { vista: 'historico', hash: '#/historico', texto: 'Histórico', icono: '📈' },
  { vista: 'ajustes', hash: '#/ajustes', texto: 'Ajustes', icono: '⚙' },
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

function EstadoConexion() {
  const enLinea = useEnLinea()
  const pendientes = useLiveQuery(() => db.outbox.count(), []) ?? 0
  const conexion = useMeta<{ url: string; token: string }>('conexion', { url: '', token: '' })
  const sync = useMeta<EstadoSync>('estadoSync', { enCurso: false, ultimoOk: null, error: null })
  let texto: string | null = null
  let color = 'bg-stone-200 text-stone-700'
  if (!conexion.url || !conexion.token) { texto = 'Sin backend: los datos quedan solo en este celular'; color = 'bg-yellow-100 text-yellow-900' }
  else if (!enLinea) { texto = `Sin señal${pendientes ? ` · ${pendientes} por enviar` : ''}` }
  else if (sync.error) { texto = `No se pudo sincronizar: ${sync.error}`; color = 'bg-red-100 text-red-800' }
  else if (sync.enCurso) texto = 'Sincronizando…'
  else if (pendientes) texto = `${pendientes} cambios por enviar`
  if (!texto) return null
  return (
    <a href="#/ajustes" className={`block px-4 py-1.5 text-center text-xs ${color}`} role="status">
      {texto}
    </a>
  )
}

export function App() {
  const ruta = useRuta()
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
      <nav className="abajo-seguro fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg">
          {PESTANAS.map((p) => {
            const activa = p.vista === ruta.vista || (p.vista === 'lista' && ruta.vista === 'producto')
            return (
              <a
                key={p.vista}
                href={p.hash}
                aria-current={activa ? 'page' : undefined}
                className={`flex flex-1 flex-col items-center py-2 text-xs ${activa ? 'font-semibold text-marca' : 'text-stone-500'}`}
              >
                <span aria-hidden className="text-lg leading-6">{p.icono}</span>
                {p.texto}
              </a>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
