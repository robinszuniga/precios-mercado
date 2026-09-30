import { useLiveQuery } from 'dexie-react-hooks'
import { resumirCambios, teTocaComprar, type Movimiento } from '@shared/novedades.ts'
import { INFO_TIENDAS } from '@shared/tiendas.ts'
import { useCatalogo, useMeta } from '../datos/consultas.ts'
import { db, guardarMeta } from '../datos/db.ts'
import { agregarALaCompra, compraAbierta } from '../datos/escritura.ts'
import { ahoraIso } from '../datos/sync.ts'
import { useTiendasHoy } from '../datos/tiendasHoy.ts'
import { avisar, Boton, pesos, Tarjeta } from './ui.tsx'

const DIAS = 3
const dia = (ms: number) => new Date(ms - 5 * 3_600_000).toISOString().slice(0, 10)

/**
 * Lo que pasó desde la última vez: precios de tus productos que bajaron o subieron (del trabajo diario) y lo que
 * sueles comprar cada tanto y ya te toca. "Ocultar" lo guarda hasta que haya algo nuevo (o al día siguiente).
 */
export function Novedades({ className = '' }: { className?: string }) {
  const cat = useCatalogo()
  const [tiendasHoy] = useTiendasHoy()
  const oculto = useMeta<number>('novedadesOcultas', 0)
  const datos = useLiveQuery(async () => {
    const [cambios, compras, detalles, abierta] = await Promise.all([
      db.cambios.where('fecha').above(Date.now() - DIAS * 86_400_000).toArray(), db.compras.toArray(), db.detalle.toArray(), compraAbierta(),
    ])
    const enCompra = new Set(abierta ? detalles.filter((d) => d.compra_id === abierta.compra_id && !d.borrado).map((d) => d.producto_id) : [])
    return { cambios, compras, detalles, enCompra }
  }, [])
  if (!cat || !datos) return null

  const presentacion = new Map(cat.presentaciones.map((p) => [p.presentacion_id, p]))
  const deQuien = (m: Movimiento) => {
    const pr = presentacion.get(m.presentacion_id)
    const p = pr?.activo ? cat.producto.get(pr.producto_id) : undefined
    return p?.activo ? p : undefined
  }
  const { bajas, subidas } = resumirCambios(datos.cambios.filter((c) => c.fecha > oculto), Date.now(), { dias: DIAS })
  const conProducto = (xs: Movimiento[], max: number) => xs.flatMap((m) => {
    const p = deQuien(m)
    return p ? [{ m, p }] : []
  }).slice(0, max)
  const b = conProducto(bajas, 4)
  const s = conProducto(subidas, 3)
  const toca = dia(oculto) === dia(Date.now()) ? [] : teTocaComprar(datos.compras, datos.detalles, ahoraIso())
    .flatMap((t) => {
      const p = cat.producto.get(t.producto_id)
      return p?.activo && !datos.enCompra.has(t.producto_id) ? [{ t, p }] : []
    })
    .slice(0, 5)
  if (!b.length && !s.length && !toca.length) return null

  const linea = ({ m, p }: { m: Movimiento; p: { producto_id: string; nombre: string } }, baja: boolean) => (
    <li key={`${m.presentacion_id}`}>
      <a href={`#/producto/${encodeURIComponent(p.producto_id)}`} className="flex min-h-11 items-center gap-2 py-1">
        <span aria-hidden className={`text-lg font-bold ${baja ? 'text-ok' : 'text-peligro'}`}>{baja ? '↓' : '↑'}</span>
        <span className="min-w-0">
          <span className="font-medium">{p.nombre}</span> {baja ? 'bajó' : 'subió'} {Math.round(Math.abs(m.variacion) * 100)} % en {INFO_TIENDAS[m.tienda].nombre}
          <span className="block text-xs text-stone-600">{pesos(m.antes)} → {pesos(m.despues)}</span>
        </span>
      </a>
    </li>
  )

  return (
    <Tarjeta className={`space-y-1 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Novedades</h2>
        <button type="button" className="min-h-11 px-2 text-sm text-stone-600 underline" onClick={() => void guardarMeta('novedadesOcultas', Date.now())}>Ocultar</button>
      </div>
      {(b.length > 0 || s.length > 0) && (
        <ul className="text-sm">
          {b.map((x) => linea(x, true))}
          {s.map((x) => linea(x, false))}
        </ul>
      )}
      {toca.length > 0 && (
        <div>
          <p className="text-sm font-medium text-stone-700">Te toca comprar</p>
          <ul className="divide-y divide-stone-100 text-sm">
            {toca.map(({ t, p }) => (
              <li key={p.producto_id} className="flex items-center justify-between gap-2 py-1">
                <span className="min-w-0">
                  <span className="font-medium">{p.nombre}</span>
                  <span className="block text-xs text-stone-600">Lo compras cada ~{t.cadaDias} días; la última vez hace {t.haceDias} {t.haceDias === 1 ? 'día' : 'días'}.</span>
                </span>
                <Boton
                  variante="fantasma"
                  className="shrink-0"
                  aria-label={`Agregar ${p.nombre} a la compra`}
                  onClick={async () => { await agregarALaCompra(p, tiendasHoy); avisar(`${p.nombre} agregado a la compra`) }}
                >
                  + Agregar
                </Boton>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Tarjeta>
  )
}
