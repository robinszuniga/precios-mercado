import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import type { Producto } from '@shared/esquema.ts'
import { etiquetaVisible, formatoContenido } from '@shared/unidades.ts'
import { useMeta } from '../datos/consultas.ts'
import { autoVincular, buscarLote, opcionesDe, productosSinVincular, seguros, vincular, type Elegido, type OpcionLote } from '../datos/vincularLote.ts'
import { avisar, Boton, Hoja, NombreTienda, pesos, Tarjeta } from './ui.tsx'

type Dudoso = { producto: Producto; opciones: OpcionLote[] }
type Fase =
  | { tipo: 'buscando'; hechos: number; total: number }
  | { tipo: 'vinculando'; hechos: number; total: number }
  | { tipo: 'revisar'; solos: number; dudosos: Dudoso[]; sinResultado: Producto[]; fallo: string | null }
  | { tipo: 'listo'; texto: string }

const clave = (o: OpcionLote) => `${o.tienda}:${o.skuId}`

function FilaOpcion({ o, unidad, nombre, marcada, onElegir }: { o: OpcionLote; unidad: Producto['unidad_base']; nombre: string; marcada: boolean; onElegir: () => void }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border px-2 py-2 ${marcada ? 'border-marca bg-marca-suave' : 'border-stone-200 bg-white'}`}>
      <input type="radio" name={nombre} className="mt-1 size-5 accent-marca" checked={marcada} onChange={onElegir} />
      <span className="min-w-0 flex-1 text-sm">
        <span className="block font-medium">{o.nombre}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-stone-700">
          <NombreTienda tienda={o.tienda} tam={16} />
          <span>{o.contenido && formatoContenido(o.contenido.valor, o.contenido.unidad)}</span>
          <span className="font-semibold text-tinta">{o.precio != null ? pesos(o.precio) : 'sin precio'}</span>
          {o.precioUnidad > 0 && <span className="tabular-nums">· {pesos(o.precioUnidad)}/{etiquetaVisible(unidad)}</span>}
        </span>
      </span>
    </label>
  )
}

/**
 * Busca en Olímpica y Éxito todos los productos sin precio de internet. Los que coinciden sin duda se vinculan
 * solos; los dudosos se muestran con la mejor opción ya elegida para confirmar con un toque.
 */
export function VincularTodos({ onListo }: { onListo: () => void }) {
  const [fase, setFase] = useState<Fase>({ tipo: 'buscando', hechos: 0, total: 0 })
  const [eleccion, setEleccion] = useState<Record<string, string>>({})
  const vivo = useRef(true)

  useEffect(() => {
    vivo.current = true
    void (async () => {
      const pendientes = await productosSinVincular()
      if (!pendientes.length) { setFase({ tipo: 'listo', texto: 'Todos tus productos ya tienen precio de internet.' }); return }
      const { resultados, fallo } = await buscarLote(
        pendientes.map((p) => ({ id: p.producto_id, q: p.nombre, unidad: p.unidad_base })),
        undefined,
        (hechos, total) => { if (vivo.current) setFase({ tipo: 'buscando', hechos, total }) },
      )
      if (!vivo.current) return
      const solos: Elegido[] = []
      const dudosos: Dudoso[] = []
      const sinResultado: Producto[] = []
      for (const p of pendientes) {
        const porTienda = resultados.get(p.producto_id)
        if (!porTienda) continue
        const s = seguros(porTienda)
        if (s.length) solos.push({ producto: p, opciones: s })
        else if (opcionesDe(porTienda).length) dudosos.push({ producto: p, opciones: opcionesDe(porTienda).slice(0, 4) })
        else sinResultado.push(p)
      }
      const n = await vincular(solos, (hechos, total) => { if (vivo.current) setFase({ tipo: 'vinculando', hechos, total }) })
      if (!vivo.current) return
      setEleccion(Object.fromEntries(dudosos.map((d) => [d.producto.producto_id, clave(d.opciones[0])])))
      setFase({ tipo: 'revisar', solos: n, dudosos, sinResultado, fallo })
    })()
    return () => { vivo.current = false }
  }, [])

  async function confirmar(dudosos: Dudoso[]) {
    const elegidos: Elegido[] = dudosos.flatMap((d) => {
      const o = d.opciones.find((x) => clave(x) === eleccion[d.producto.producto_id])
      return o ? [{ producto: d.producto, opciones: [o] }] : []
    })
    const n = await vincular(elegidos, (hechos, total) => setFase({ tipo: 'vinculando', hechos, total }))
    avisar(`Listo: ${n === 1 ? '1 producto más' : `${n} productos más`} con precio de internet.`)
    onListo()
  }

  if (fase.tipo === 'buscando' || fase.tipo === 'vinculando') {
    const pct = fase.total ? Math.round((fase.hechos / fase.total) * 100) : 0
    return (
      <div className="space-y-3 pb-4" aria-busy="true">
        <p className="text-stone-700">
          {fase.tipo === 'buscando'
            ? `Buscando tus productos en Olímpica y Éxito${fase.total ? ` (${fase.hechos} de ${fase.total})` : ''}…`
            : `Guardando los que coinciden${fase.total ? ` (${fase.hechos} de ${fase.total})` : ''}…`}
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-stone-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-marca transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm text-stone-600">Puede tardar un par de minutos. Puedes cerrar esto: lo ya guardado queda.</p>
      </div>
    )
  }

  if (fase.tipo === 'listo') {
    return (
      <div className="space-y-3 pb-4">
        <p>{fase.texto}</p>
        <Boton className="w-full" onClick={onListo}>Cerrar</Boton>
      </div>
    )
  }

  const { solos, dudosos, sinResultado, fallo } = fase
  const aVincular = dudosos.filter((d) => eleccion[d.producto.producto_id] !== 'ninguno').length
  return (
    <div className="space-y-3 pb-4">
      <p className={solos ? 'font-medium text-ok' : 'text-stone-700'}>
        {solos ? `✔ ${solos === 1 ? '1 producto quedó' : `${solos} productos quedaron`} con precio de internet, solos.` : 'Ninguno coincidió sin duda.'}
      </p>
      {fallo && <p role="alert" className="text-sm font-medium text-peligro">Se detuvo: {fallo}</p>}
      {dudosos.length > 0 && (
        <>
          <p className="text-sm text-stone-700">
            {dudosos.length === 1 ? 'Este tiene dudas' : `Estos ${dudosos.length} tienen dudas`}. Dejé elegida la opción más parecida: cámbiala o marca “Ninguno”.
          </p>
          {dudosos.map((d) => {
            const id = d.producto.producto_id
            return (
              <Tarjeta key={id} className="space-y-2">
                <h3 className="font-semibold">{d.producto.nombre}</h3>
                <div role="radiogroup" aria-label={`Opciones para ${d.producto.nombre}`} className="space-y-1.5">
                  {d.opciones.map((o) => (
                    <FilaOpcion key={clave(o)} o={o} unidad={d.producto.unidad_base} nombre={id} marcada={eleccion[id] === clave(o)} onElegir={() => setEleccion({ ...eleccion, [id]: clave(o) })} />
                  ))}
                  <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-2 ${eleccion[id] === 'ninguno' ? 'border-marca bg-marca-suave' : 'border-stone-200 bg-white'}`}>
                    <input type="radio" name={id} className="size-5 accent-marca" checked={eleccion[id] === 'ninguno'} onChange={() => setEleccion({ ...eleccion, [id]: 'ninguno' })} />
                    <span className="text-sm">Ninguno de estos</span>
                  </label>
                </div>
              </Tarjeta>
            )
          })}
        </>
      )}
      {sinResultado.length > 0 && (
        <p className="text-sm text-stone-700">
          No encontré en internet: <strong>{sinResultado.map((p) => p.nombre).join(', ')}</strong>. Anota su precio en la tienda
          o búscalo con otras palabras desde el producto (“Buscar online”).
        </p>
      )}
      {dudosos.length > 0 ? (
        <Boton className="w-full" onClick={() => void confirmar(dudosos)} disabled={aVincular === 0}>
          {aVincular ? `Vincular ${aVincular} ${aVincular === 1 ? 'producto' : 'productos'}` : 'Nada que vincular'}
        </Boton>
      ) : (
        <Boton className="w-full" onClick={onListo}>Listo</Boton>
      )}
    </div>
  )
}

/** Aviso con botón: "N productos sin precio de internet · Buscar precios". Solo con la copia en Google activa. */
export function AvisoSinVincular({ className = '' }: { className?: string }) {
  const c = useMeta<{ url: string; token: string }>('conexion', { url: '', token: '' })
  const n = useLiveQuery(async () => (await productosSinVincular()).length, [], 0)
  const [abierta, setAbierta] = useState(false)
  if (!c.url || !c.token || !n) return null
  return (
    <>
      <Tarjeta className={`flex items-center justify-between gap-2 ${className}`}>
        <p className="text-sm text-stone-700"><strong>{n}</strong> {n === 1 ? 'producto' : 'productos'} sin precio de internet</p>
        <Boton variante="secundario" className="shrink-0" onClick={() => setAbierta(true)}>Buscar precios</Boton>
      </Tarjeta>
      <Hoja abierta={abierta} titulo="Precios de internet" onCerrar={() => setAbierta(false)} protegida>
        <VincularTodos onListo={() => setAbierta(false)} />
      </Hoja>
    </>
  )
}

/** Lo automático con aviso: se llama al abrir la app y después de pegar la lista. */
export async function buscarPreciosSolo(forzar = false) {
  const r = await autoVincular({ forzar })
  if (!r || (!r.vinculados && !r.dudosos)) return
  avisar(r.vinculados
    ? `Precios de internet: ${r.vinculados === 1 ? '1 producto vinculado' : `${r.vinculados} productos vinculados`} solos${r.dudosos ? `; ${r.dudosos} para revisar en Productos` : ''}.`
    : `${r.dudosos} productos necesitan que elijas cuál es: toca “Buscar precios” en Productos.`)
}
