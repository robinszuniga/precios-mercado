import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { normalizar } from '@shared/contenido.ts'
import type { PrecioHistorico, Producto } from '@shared/esquema.ts'
import { aMs } from '@shared/fechas.ts'
import { INFO_TIENDAS, TIENDAS, esTienda } from '@shared/tiendas.ts'
import { etiquetaVisible, precioPorUnidad } from '@shared/unidades.ts'
import { Grafico, type Serie } from '../componentes/Grafico.tsx'
import { NombreTienda, pesos, Tarjeta, Titulo, Vacio } from '../componentes/ui.tsx'
import { llamar } from '../datos/api.ts'
import { useCatalogo, type Catalogo } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { conexion } from '../datos/sync.ts'

function fecha(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

function HistoricoProducto({ cat, producto }: { cat: Catalogo; producto: Producto }) {
  const [porUnidad, setPorUnidad] = useState(true)
  const presentaciones = cat.presentacionesDe.get(producto.producto_id) ?? []
  const ids = presentaciones.map((p) => p.presentacion_id)
  const filas = useLiveQuery(() => db.historial.where('presentacion_id').anyOf(ids).toArray(), [ids.join(',')]) ?? []

  useEffect(() => {
    void (async () => {
      const r = await llamar<{ filas: PrecioHistorico[] }>(await conexion(), 'historialPrecios', { productoId: producto.producto_id })
      if (r.tipo === 'ok' && r.data.filas.length) await db.historial.bulkPut(r.data.filas)
    })()
  }, [producto.producto_id])

  const series = useMemo<Serie[]>(() => {
    const pres = new Map(presentaciones.map((p) => [p.presentacion_id, p]))
    const puntos = [
      ...filas.map((f) => ({ pid: f.presentacion_id, precio: f.precio, fecha: f.fecha_observado, disponible: f.disponible })),
      // El actual se extiende hasta la última verificación, así la línea llega a hoy.
      ...ids.flatMap((id) => (cat.actualesDe.get(id) ?? []).map((a) => ({ pid: id, precio: a.precio, fecha: a.fecha_verificado, disponible: a.disponible }))),
    ]
    return TIENDAS.map((t) => {
      const porT = new Map<number, number>()
      for (const x of puntos) {
        const p = pres.get(x.pid)
        if (!p || p.tienda !== t || x.precio == null || !x.disponible) continue
        const v = porUnidad ? precioPorUnidad(x.precio, p.contenido, producto.unidad_base) : x.precio
        if (v == null) continue
        const ms = aMs(x.fecha)
        // Varias presentaciones el mismo momento: la más barata.
        porT.set(ms, Math.min(porT.get(ms) ?? Infinity, Math.round(v)))
      }
      return { tienda: t, puntos: [...porT].map(([ms, v]) => ({ t: ms, v })).sort((a, b) => a.t - b.t) }
    }).filter((s) => s.puntos.length)
  }, [filas, presentaciones, ids, cat.actualesDe, porUnidad, producto.unidad_base])

  const u = etiquetaVisible(producto.unidad_base)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{producto.nombre}</h2>
        <button type="button" className="text-sm text-marca" onClick={() => setPorUnidad(!porUnidad)}>{porUnidad ? `$/${u}` : 'paquete'} ⇄</button>
      </div>
      {series.length ? (
        <Tarjeta><Grafico series={series} etiqueta={porUnidad ? `/${u}` : ''} /></Tarjeta>
      ) : (
        <Vacio>Todavía no hay historia de precios para este producto.</Vacio>
      )}
      {series.map((s) => {
        const primero = s.puntos[0].v
        const ultimo = s.puntos[s.puntos.length - 1].v
        const cambio = primero ? Math.round(((ultimo - primero) / primero) * 100) : 0
        return (
          <div key={s.tienda} className="flex justify-between text-sm">
            <NombreTienda tienda={s.tienda} />
            <span>{pesos(ultimo)} {cambio !== 0 && <span className={cambio > 0 ? 'text-peligro' : 'text-ok'}>{cambio > 0 ? '▲' : '▼'} {Math.abs(cambio)}%</span>}</span>
          </div>
        )
      })}
    </div>
  )
}

function ResumenCompra({ cat, compraId }: { cat: Catalogo; compraId: string }) {
  const datos = useLiveQuery(async () => ({
    compra: await db.compras.get(compraId),
    detalles: await db.detalle.where('compra_id').equals(compraId).toArray(),
    resumen: await db.resumen.where('compra_id').equals(compraId).toArray(),
  }), [compraId])
  if (!datos) return null
  const { compra, detalles, resumen } = datos
  if (!compra) return <Vacio>No encuentro esa compra.</Vacio>
  const ref = esTienda(compra.tienda_referencia) ? compra.tienda_referencia : null
  const comprados = detalles.filter((d) => !d.borrado && d.estado === 'en_carrito')
  return (
    <div className="space-y-3">
      <a href="#/historico" className="text-sm text-marca">← Histórico</a>
      <Titulo>Compra del {fecha(compra.fecha_cierre || compra.fecha_inicio)}</Titulo>
      <Tarjeta className="space-y-1">
        <div className="flex justify-between text-lg font-semibold"><span>Gastaste</span><span>{pesos(compra.total_final)}</span></div>
        {compra.presupuesto != null && <div className="flex justify-between text-stone-600"><span>Presupuesto</span><span>{pesos(compra.presupuesto)}</span></div>}
        {ref && compra.ahorro != null && (
          <p className={`pt-1 font-medium ${compra.ahorro >= 0 ? 'text-ok' : 'text-peligro'}`}>
            {compra.ahorro >= 0
              ? `Ahorraste ${pesos(compra.ahorro)} frente a comprar todo en ${INFO_TIENDAS[ref].nombre}`
              : `Gastaste ${pesos(-compra.ahorro)} más que comprando todo en ${INFO_TIENDAS[ref].nombre}`}
            {compra.items_comparados != null && compra.items_total != null && compra.items_comparados < compra.items_total && (
              <span className="block text-xs font-normal text-stone-500">comparado sobre {compra.items_comparados} de {compra.items_total} productos</span>
            )}
          </p>
        )}
      </Tarjeta>
      {resumen.length > 0 && (
        <Tarjeta>
          <h2 className="mb-1 font-semibold">Si hubieras comprado todo en…</h2>
          {resumen.sort((a, b) => a.total_hipotetico - b.total_hipotetico).map((r) => (
            <div key={r.clave} className="flex justify-between py-0.5 text-sm">
              <NombreTienda tienda={r.tienda} />
              <span>{pesos(r.total_hipotetico)} {!r.completo && <span className="text-xs text-stone-500">({r.items_con_precio} de {r.items_total})</span>}</span>
            </div>
          ))}
        </Tarjeta>
      )}
      <Tarjeta>
        <h2 className="mb-1 font-semibold">Lo que compraste</h2>
        <ul className="divide-y divide-stone-100 text-sm">
          {comprados.map((d) => (
            <li key={d.detalle_id} className="flex justify-between py-1">
              <span>{d.producto_id ? cat.producto.get(d.producto_id)?.nombre : d.nombre_libre} <span className="text-stone-500">{d.tienda && `· ${INFO_TIENDAS[d.tienda].nombre}`}</span></span>
              <span>{pesos(d.subtotal)}</span>
            </li>
          ))}
        </ul>
      </Tarjeta>
    </div>
  )
}

export function Historico({ productoId, compraId }: { productoId?: string; compraId?: string }) {
  const cat = useCatalogo()
  const [q, setQ] = useState('')
  const compras = useLiveQuery(async () => (await db.compras.where('estado').equals('cerrada').toArray()).filter((c) => !c.borrado).sort((a, b) => (a.fecha_cierre < b.fecha_cierre ? 1 : -1)), []) ?? []
  if (!cat) return null
  if (compraId) return <ResumenCompra cat={cat} compraId={compraId} />
  const producto = productoId ? cat.producto.get(productoId) : undefined
  const nq = normalizar(q)
  const encontrados = nq ? cat.productos.filter((p) => normalizar(p.nombre).includes(nq)).slice(0, 8) : []

  return (
    <section className="space-y-4">
      <Titulo>Histórico</Titulo>
      <div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ver precios de un producto…" aria-label="Buscar producto para ver su histórico" className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5" />
        {encontrados.length > 0 && (
          <ul className="mt-1 rounded-xl bg-white ring-1 ring-stone-200">
            {encontrados.map((p) => (
              <li key={p.producto_id}><a className="block px-3 py-2" href={`#/historico/producto/${encodeURIComponent(p.producto_id)}`} onClick={() => setQ('')}>{p.nombre}</a></li>
            ))}
          </ul>
        )}
      </div>
      {producto && <HistoricoProducto cat={cat} producto={producto} />}
      <div>
        <h2 className="mb-2 font-semibold">Compras cerradas</h2>
        {compras.length === 0 && <Vacio>Cuando cierres una compra aparece aquí con lo que ahorraste.</Vacio>}
        <ul className="space-y-2">
          {compras.map((c) => (
            <li key={c.compra_id}>
              <a href={`#/historico/compra/${encodeURIComponent(c.compra_id)}`} className="flex items-center justify-between rounded-2xl bg-white p-3 ring-1 ring-stone-200">
                <span>
                  <span className="block font-medium">{fecha(c.fecha_cierre || c.fecha_inicio)}</span>
                  {c.ahorro != null && c.tienda_referencia && (
                    <span className={`text-xs ${c.ahorro >= 0 ? 'text-ok' : 'text-peligro'}`}>
                      {c.ahorro >= 0 ? `ahorro ${pesos(c.ahorro)}` : `${pesos(-c.ahorro)} de más`} vs {esTienda(c.tienda_referencia) ? INFO_TIENDAS[c.tienda_referencia].nombre : c.tienda_referencia}
                    </span>
                  )}
                </span>
                <span className="font-semibold">{pesos(c.total_final)}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
