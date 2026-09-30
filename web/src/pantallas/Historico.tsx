import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { normalizar } from '@shared/contenido.ts'
import type { PrecioHistorico, Producto } from '@shared/esquema.ts'
import { formatoNumero } from '@shared/dinero.ts'
import { aMs, diaBogota } from '@shared/fechas.ts'
import { INFO_TIENDAS, TIENDAS, esTienda } from '@shared/tiendas.ts'
import { etiquetaVisible, precioPorUnidad } from '@shared/unidades.ts'
import { fechaCorta, Grafico, MuestraLinea, type Serie } from '../componentes/Grafico.tsx'
import { Cargando, NombreTienda, pesos, Tarjeta, Titulo, Vacio } from '../componentes/ui.tsx'
import { llamar } from '../datos/api.ts'
import { useCatalogo, type Catalogo } from '../datos/consultas.ts'
import { db } from '../datos/db.ts'
import { ahoraIso, conexion } from '../datos/sync.ts'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function fecha(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${Number(d)} de ${MESES[Number(m) - 1]} de ${a}`
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
      // El actual se extiende hasta la última verificación, así la línea llega a hoy con el mismo precio que la ficha.
      ...ids.flatMap((id) => (cat.actualesDe.get(id) ?? []).flatMap((a) => [
        { pid: id, precio: a.precio, fecha: a.fecha_observado, disponible: a.disponible },
        { pid: id, precio: a.precio, fecha: a.fecha_verificado, disponible: a.disponible },
      ])),
    ]
    return TIENDAS.map((t) => {
      const porT = new Map<number, number>()
      for (const x of puntos) {
        const p = pres.get(x.pid)
        if (!p || p.tienda !== t || x.precio == null || !x.disponible) continue
        const v = porUnidad ? precioPorUnidad(x.precio, p.contenido, producto.unidad_base) : x.precio
        if (v == null) continue
        const ms = aMs(x.fecha)
        porT.set(ms, Math.min(porT.get(ms) ?? Infinity, Math.round(v)))
      }
      return { tienda: t, puntos: [...porT].map(([ms, v]) => ({ t: ms, v })).sort((a, b) => a.t - b.t) }
    }).filter((s) => s.puntos.length)
  }, [filas, presentaciones, ids, cat.actualesDe, porUnidad, producto.unidad_base])

  const u = etiquetaVisible(producto.unidad_base)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{producto.nombre}</h2>
        <div className="flex rounded-full border border-stone-300 bg-white text-sm" role="group" aria-label="Ver precio">
          {[true, false].map((v) => (
            <button key={String(v)} type="button" aria-pressed={porUnidad === v} onClick={() => setPorUnidad(v)} className={`min-h-11 rounded-full px-3 ${porUnidad === v ? 'bg-marca-suave font-semibold text-teal-900' : 'text-stone-700'}`}>
              {v ? `por ${u}` : 'por paquete'}
            </button>
          ))}
        </div>
      </div>
      {series.length ? <Tarjeta><Grafico series={series} /></Tarjeta> : <Vacio>Todavía no hay historia de precios para este producto.</Vacio>}
      <ul className="space-y-1">
        {series.map((s) => {
          const primero = s.puntos[0]
          const ultimo = s.puntos[s.puntos.length - 1].v
          const cambio = primero.v ? Math.round(((ultimo - primero.v) / primero.v) * 100) : 0
          return (
            <li key={s.tienda} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2"><MuestraLinea tienda={s.tienda} /><NombreTienda tienda={s.tienda} tam={18} /></span>
              <span className="text-right">
                <span className="font-semibold">{pesos(ultimo)}{porUnidad ? `/${u}` : ''}</span>
                {cambio !== 0 && (
                  <span className={`block text-xs ${cambio > 0 ? 'text-peligro' : 'text-ok'}`}>
                    {cambio > 0 ? '▲ subió' : '▼ bajó'} {Math.abs(cambio)} % desde el {fechaCorta(primero.t)}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ResumenCompra({ cat, compraId }: { cat: Catalogo; compraId: string }) {
  const datos = useLiveQuery(async () => ({
    compra: await db.compras.get(compraId),
    detalles: await db.detalle.where('compra_id').equals(compraId).toArray(),
    resumen: await db.resumen.where('compra_id').equals(compraId).toArray(),
  }), [compraId])
  if (!datos) return <Cargando />
  const { compra, detalles, resumen } = datos
  if (!compra) return <Vacio>No encuentro esa compra.</Vacio>
  const ref = esTienda(compra.tienda_referencia) ? compra.tienda_referencia : null
  const comprados = detalles.filter((d) => !d.borrado && d.estado === 'en_carrito')
  const completas = resumen.filter((r) => r.completo).sort((a, b) => a.total_hipotetico - b.total_hipotetico)
  const parciales = resumen.filter((r) => !r.completo).sort((a, b) => b.items_con_precio - a.items_con_precio)
  const compraCompleta = compra.items_comparados == null || compra.items_total == null || compra.items_comparados >= compra.items_total
  const sobro = compra.presupuesto != null && compra.total_final != null ? compra.presupuesto - compra.total_final : null
  return (
    <div className="space-y-3">
      <a href="#/historico" className="inline-flex min-h-11 items-center text-marca">← Historial</a>
      <Titulo>Compra del {fecha(compra.fecha_cierre || compra.fecha_inicio)}</Titulo>
      <Tarjeta className="space-y-1">
        {ref && compra.ahorro != null && (
          <>
            {/* Celebrar el ahorro solo si se pudo comparar todo lo comprado: con datos parciales no se puede afirmar. */}
            <p className={`text-2xl font-bold ${!compraCompleta ? 'text-stone-800' : compra.ahorro >= 0 ? 'text-ok' : 'text-peligro'}`}>
              {!compraCompleta
                ? `Hasta donde pude comparar, ${compra.ahorro >= 0 ? `ahorraste ${pesos(compra.ahorro)}` : `gastaste ${pesos(-compra.ahorro)} de más`}`
                : compra.ahorro >= 0 ? `¡Ahorraste ${pesos(compra.ahorro)}!` : `Gastaste ${pesos(-compra.ahorro)} de más`}
            </p>
            <p className="text-sm text-stone-700">
              frente a comprar todo en {INFO_TIENDAS[ref].nombre}
              {!compraCompleta && ` (comparado sobre ${compra.items_comparados} de ${compra.items_total} productos: a los demás les faltaba precio)`}
            </p>
          </>
        )}
        <div className="flex justify-between pt-2 text-lg font-semibold"><span>Gastaste</span><span>{pesos(compra.total_final)}</span></div>
        {sobro != null && (
          <p className={`text-sm ${sobro >= 0 ? 'text-stone-700' : 'text-peligro'}`}>
            {sobro >= 0 ? `Te sobraron ${pesos(sobro)} del presupuesto (${pesos(compra.presupuesto)})` : `Te pasaste ${pesos(-sobro)} del presupuesto (${pesos(compra.presupuesto)})`}
          </p>
        )}
      </Tarjeta>
      {resumen.length > 0 && (
        <Tarjeta className="space-y-1">
          <h2 className="font-semibold">Si hubieras comprado todo en…</h2>
          {completas.map((r) => (
            <div key={r.clave} className="flex justify-between py-0.5 text-sm">
              <NombreTienda tienda={r.tienda} tam={18} />
              <span className="font-medium">{pesos(r.total_hipotetico)}</span>
            </div>
          ))}
          {parciales.length > 0 && (
            <>
              <p className="pt-1 text-xs text-stone-600">Con datos parciales (no tenían precio de todo):</p>
              {parciales.map((r) => (
                <div key={r.clave} className="flex justify-between py-0.5 text-sm text-stone-700">
                  <NombreTienda tienda={r.tienda} tam={18} />
                  <span>{pesos(r.total_hipotetico)} en {r.items_con_precio} de {r.items_total}</span>
                </div>
              ))}
            </>
          )}
        </Tarjeta>
      )}
      <a href="#/compra" className="flex min-h-11 items-center justify-center rounded-xl bg-marca px-4 font-medium text-white active:bg-teal-800">Empezar otra compra</a>
      <Tarjeta>
        <h2 className="mb-1 font-semibold">Lo que compraste</h2>
        <ul className="divide-y divide-stone-100 text-sm">
          {comprados.map((d) => (
            <li key={d.detalle_id} className="flex justify-between gap-2 py-1.5">
              <span className="min-w-0">
                {d.producto_id ? cat.producto.get(d.producto_id)?.nombre : d.nombre_libre}
                <span className="text-stone-600"> · {formatoNumero(d.cantidad ?? 0)} × {pesos(d.precio_unitario)}{d.tienda && ` · ${INFO_TIENDAS[d.tienda].nombre}`}</span>
              </span>
              <span className="shrink-0">{pesos(d.subtotal)}</span>
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
  const compras = useLiveQuery(async () => (await db.compras.where('estado').equals('cerrada').toArray()).filter((c) => !c.borrado).sort((a, b) => (a.fecha_cierre < b.fecha_cierre ? 1 : -1)), [])
  if (!cat || !compras) return <Cargando />
  if (compraId) return <ResumenCompra cat={cat} compraId={compraId} />
  const producto = productoId ? cat.producto.get(productoId) : undefined
  const nq = normalizar(q)
  const encontrados = nq ? cat.productos.filter((p) => normalizar(p.nombre).includes(nq)).slice(0, 8) : []
  const mes = diaBogota(ahoraIso()).slice(0, 7)
  const delMes = compras.filter((c) => (c.fecha_cierre || c.fecha_inicio).slice(0, 7) === mes)
  const gastoMes = delMes.reduce((s, c) => s + (c.total_final ?? 0), 0)
  const ahorroMes = delMes.reduce((s, c) => s + (c.ahorro ?? 0), 0)

  return (
    <section className="space-y-4">
      <Titulo>Historial</Titulo>
      {delMes.length > 0 && (
        <Tarjeta>
          <p className="text-sm text-stone-700">En {MESES[Number(mes.slice(5, 7)) - 1]}: {delMes.length} {delMes.length === 1 ? 'compra' : 'compras'}</p>
          <p className="text-xl font-bold">Gastaste {pesos(gastoMes)}</p>
          {ahorroMes !== 0 && <p className={`font-medium ${ahorroMes > 0 ? 'text-ok' : 'text-peligro'}`}>{ahorroMes > 0 ? `Ahorraste ${pesos(ahorroMes)}` : `${pesos(-ahorroMes)} de más`} comparando tiendas</p>}
        </Tarjeta>
      )}
      <div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ver cómo cambia el precio de…" aria-label="Buscar producto para ver cómo cambia su precio" className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5" />
        {encontrados.length > 0 && (
          <ul className="mt-1 rounded-xl bg-white ring-1 ring-stone-200">
            {encontrados.map((p) => (
              <li key={p.producto_id}><a className="flex min-h-11 items-center px-3" href={`#/historico/producto/${encodeURIComponent(p.producto_id)}`} onClick={() => setQ('')}>{p.nombre}</a></li>
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
              <a href={`#/historico/compra/${encodeURIComponent(c.compra_id)}`} className="flex items-center justify-between rounded-2xl bg-white p-3 ring-1 ring-stone-200 active:bg-stone-50">
                <span>
                  <span className="block font-medium">{fecha(c.fecha_cierre || c.fecha_inicio)}</span>
                  {c.ahorro != null && c.tienda_referencia && (
                    <span className={`text-sm ${c.ahorro >= 0 ? 'text-ok' : 'text-peligro'}`}>
                      {c.ahorro >= 0 ? `ahorraste ${pesos(c.ahorro)}` : `${pesos(-c.ahorro)} de más`} vs {esTienda(c.tienda_referencia) ? INFO_TIENDAS[c.tienda_referencia].nombre : c.tienda_referencia}
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
